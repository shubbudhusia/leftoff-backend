const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// Razorpay API (optional — skip if keys not configured, so the server
// can still start without them)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const razorpayClient = require('razorpay');
  razorpay = new razorpayClient({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  console.warn('⚠️ Razorpay keys not set — payment sync from Razorpay disabled');
}

// Stripe API (optional)
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
if (!stripe) {
  console.warn('⚠️ STRIPE_SECRET_KEY not set — payment sync from Stripe disabled');
}

class DataSyncService {
  async syncAllData() {
    console.log('🔄 Starting daily data sync...');
    try {
      // 1. Pull Razorpay payments
      await this.syncRazorpayPayments();
      console.log('✅ Razorpay payments synced');

      // 2. Pull Stripe payments
      await this.syncStripePayments();
      console.log('✅ Stripe payments synced');

      // 3. Sync user activity from extension
      await this.syncUserActivity();
      console.log('✅ User activity synced');

      // 4. Update trial tracking
      await this.updateTrialTracking();
      console.log('✅ Trial tracking updated');

      // 5. Calculate dashboard metrics
      await this.calculateDashboardMetrics();
      console.log('✅ Dashboard metrics calculated');

      // 6. Generate Excel reports
      await this.generateDailyReports();
      console.log('✅ Excel reports generated');

      console.log('✨ Daily sync completed successfully!');
      return { success: true, timestamp: new Date() };
    } catch (error) {
      console.error('❌ Sync error:', error.message);
      throw error;
    }
  }

  // Sync Razorpay Payments
  async syncRazorpayPayments() {
    if (!razorpay) return; // not configured
    try {
      const payments = await razorpay.payments.all({ count: 100 });

      for (const payment of payments.items) {
        // Check if payment already exists
        const { data: existing } = await supabase
          .from('payments')
          .select('id')
          .eq('transaction_id', payment.id)
          .single();

        if (!existing) {
          // Find user by email
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', payment.email)
            .single();

          if (user) {
            const planType = payment.notes?.plan_type || 'MONTHLY';
            const amount = payment.amount / 100; // Razorpay returns in paise

            await supabase.from('payments').insert({
              user_id: user.id,
              transaction_id: payment.id,
              purchase_date: new Date(payment.created_at * 1000),
              plan_type: planType,
              amount: amount,
              currency: 'INR',
              tax: payment.tax || 0,
              total_paid: amount + (payment.tax || 0),
              payment_status: payment.status.toUpperCase(),
              payment_method: payment.method || 'UNKNOWN',
              payment_gateway: 'RAZORPAY',
              plan_start_date: new Date(payment.created_at * 1000),
              plan_end_date: this.calculatePlanEndDate(planType, new Date(payment.created_at * 1000)),
              auto_renewal_enabled: true,
              notes: `Razorpay Payment - ${payment.method}`
            });
          }
        }
      }
    } catch (error) {
      console.error('Error syncing Razorpay payments:', error.message);
    }
  }

  // Sync Stripe Payments
  async syncStripePayments() {
    if (!stripe) return; // not configured
    try {
      const charges = await stripe.charges.list({ limit: 100 });

      for (const charge of charges.data) {
        // Check if payment already exists
        const { data: existing } = await supabase
          .from('payments')
          .select('id')
          .eq('transaction_id', charge.id)
          .single();

        if (!existing && charge.paid) {
          // Find user by email
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', charge.billing_details?.email || charge.receipt_email)
            .single();

          if (user) {
            const amount = charge.amount / 100; // Stripe returns in cents
            const planType = charge.metadata?.plan_type || 'YEARLY';

            await supabase.from('payments').insert({
              user_id: user.id,
              transaction_id: charge.id,
              purchase_date: new Date(charge.created * 1000),
              plan_type: planType,
              amount: amount,
              currency: 'USD',
              tax: (charge.amount * 0.1) / 100 || 0, // Estimate 10% tax
              total_paid: amount,
              payment_status: 'COMPLETED',
              payment_method: charge.payment_method_details?.type?.toUpperCase() || 'CARD',
              payment_gateway: 'STRIPE',
              plan_start_date: new Date(charge.created * 1000),
              plan_end_date: this.calculatePlanEndDate(planType, new Date(charge.created * 1000)),
              auto_renewal_enabled: charge.metadata?.auto_renew === 'true',
              notes: `Stripe Payment - ${charge.payment_method_details?.type}`
            });
          }
        }
      }
    } catch (error) {
      console.error('Error syncing Stripe payments:', error.message);
    }
  }

  // Sync User Activity from Extension
  async syncUserActivity() {
    try {
      const { data: users } = await supabase
        .from('users')
        .select('id, email');

      for (const user of users) {
        // Get user's extension data (you'll need to implement this based on your extension storage)
        const { data: activity } = await supabase
          .from('user_activity')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (!activity) {
          // Create initial activity record
          await supabase.from('user_activity').insert({
            user_id: user.id,
            total_videos_queued: 0,
            total_videos_watched: 0,
            abandoned_videos: 0,
            watch_rate_percentage: 0,
            total_watch_time_hours: 0
          });
        }
      }
    } catch (error) {
      console.error('Error syncing user activity:', error.message);
    }
  }

  // Update Trial Tracking
  async updateTrialTracking() {
    try {
      const { data: trials } = await supabase
        .from('trial_tracking')
        .select('*')
        .eq('trial_status', 'ACTIVE');

      for (const trial of trials) {
        const now = new Date();
        const endDate = new Date(trial.trial_end_date);
        const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

        let status = 'ACTIVE';
        if (daysRemaining <= 0) {
          status = 'EXPIRED';
        }

        await supabase
          .from('trial_tracking')
          .update({
            days_remaining: Math.max(0, daysRemaining),
            trial_status: status,
            updated_at: now
          })
          .eq('id', trial.id);
      }
    } catch (error) {
      console.error('Error updating trial tracking:', error.message);
    }
  }

  // Calculate Dashboard Metrics
  async calculateDashboardMetrics() {
    try {
      // Total users
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      // Active users (with activity in last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { data: activeUsers } = await supabase
        .from('extension_events')
        .select('user_id', { distinct: true })
        .gt('event_date', sevenDaysAgo.toISOString());

      // Premium users (active subscriptions)
      const { data: premiumUsers } = await supabase
        .from('payments')
        .select('user_id', { distinct: true })
        .eq('payment_status', 'COMPLETED')
        .gt('plan_end_date', new Date().toISOString());

      // Total revenue
      const { data: payments } = await supabase
        .from('payments')
        .select('total_paid, currency');

      let totalRevenueINR = 0;
      let totalRevenueUSD = 0;

      payments.forEach(p => {
        if (p.currency === 'INR') {
          totalRevenueINR += p.total_paid;
        } else {
          totalRevenueUSD += p.total_paid;
        }
      });

      // Indian users
      const { count: indianUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('country', 'India');

      // Insert metrics
      const metrics = [
        { metric_type: 'total_users', metric_value: totalUsers },
        { metric_type: 'active_users_7d', metric_value: activeUsers?.length || 0 },
        { metric_type: 'premium_users', metric_value: premiumUsers?.length || 0 },
        { metric_type: 'total_revenue_inr', metric_value_decimal: totalRevenueINR, currency: 'INR' },
        { metric_type: 'total_revenue_usd', metric_value_decimal: totalRevenueUSD, currency: 'USD' },
        { metric_type: 'indian_users', metric_value: indianUsers },
        { metric_type: 'conversion_rate', metric_value_decimal: ((premiumUsers?.length || 0) / (totalUsers || 1) * 100) },
        { metric_type: 'date_recorded', metric_value: new Date().getDate() }
      ];

      for (const metric of metrics) {
        await supabase.from('dashboard_metrics').insert(metric);
      }

      console.log(`📊 Metrics: ${totalUsers} total users, ${premiumUsers?.length || 0} premium, ₹${totalRevenueINR} + $${totalRevenueUSD}`);
    } catch (error) {
      console.error('Error calculating metrics:', error.message);
    }
  }

  // Generate Daily Reports
  async generateDailyReports() {
    try {
      // Get Indian users
      const { data: indianUsers } = await supabase
        .from('users')
        .select(`
          *,
          trial_tracking(*),
          user_activity(*),
          payments(*)
        `)
        .eq('country', 'India');

      // Get International users
      const { data: intlUsers } = await supabase
        .from('users')
        .select(`
          *,
          trial_tracking(*),
          user_activity(*),
          payments(*)
        `)
        .neq('country', 'India');

      // Generate Indian report
      if (indianUsers?.length > 0) {
        await this.generateExcelReport(indianUsers, 'LeftOff_Indian_Users_Daily.xlsx', 'INR');
      }

      // Generate International report
      if (intlUsers?.length > 0) {
        await this.generateExcelReport(intlUsers, 'LeftOff_International_Users_Daily.xlsx', 'USD');
      }

      console.log('📄 Reports generated successfully');
    } catch (error) {
      console.error('Error generating reports:', error.message);
    }
  }

  // Generate Excel Report
  async generateExcelReport(users, filename, currency) {
    const wb = new ExcelJS.Workbook();

    // Installation & Profile sheet
    const wsProfile = wb.addWorksheet('Installation & Profile');
    wsProfile.columns = [
      { header: 'User ID', key: 'id', width: 12 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'Installation Date', key: 'installation_date', width: 16 },
      { header: 'Browser', key: 'browser', width: 12 },
      { header: 'OS', key: 'os', width: 12 },
      { header: 'Referral Source', key: 'referral_source', width: 18 },
      { header: 'Device Type', key: 'device_type', width: 12 }
    ];
    this.styleHeader(wsProfile);

    users.forEach(user => {
      wsProfile.addRow({
        id: user.id,
        email: user.email,
        name: user.name || 'N/A',
        country: user.country || 'N/A',
        city: user.city || 'N/A',
        installation_date: user.installation_date,
        browser: user.browser || 'N/A',
        os: user.os || 'N/A',
        referral_source: user.referral_source || 'N/A',
        device_type: user.device_type || 'N/A'
      });
    });

    // Payments sheet
    const wsPayments = wb.addWorksheet('Payments');
    wsPayments.columns = [
      { header: 'User ID', key: 'user_id', width: 12 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Plan Type', key: 'plan_type', width: 15 },
      { header: `Amount (${currency})`, key: 'amount', width: 12 },
      { header: 'Purchase Date', key: 'purchase_date', width: 14 },
      { header: 'Status', key: 'payment_status', width: 12 },
      { header: 'Gateway', key: 'payment_gateway', width: 12 },
      { header: 'Plan End', key: 'plan_end_date', width: 14 },
      { header: `Lifetime Value (${currency})`, key: 'lifetime_value', width: 16 }
    ];
    this.styleHeader(wsPayments);

    users.forEach(user => {
      user.payments?.forEach(payment => {
        wsPayments.addRow({
          user_id: user.id,
          email: user.email,
          plan_type: payment.plan_type,
          amount: payment.total_paid,
          purchase_date: payment.purchase_date,
          payment_status: payment.payment_status,
          payment_gateway: payment.payment_gateway,
          plan_end_date: payment.plan_end_date,
          lifetime_value: payment.lifetime_value
        });
      });
    });

    // Activity sheet
    const wsActivity = wb.addWorksheet('Activity');
    wsActivity.columns = [
      { header: 'User ID', key: 'user_id', width: 12 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Videos Queued', key: 'total_videos_queued', width: 14 },
      { header: 'Videos Watched', key: 'total_videos_watched', width: 14 },
      { header: 'Watch Rate %', key: 'watch_rate_percentage', width: 12 },
      { header: 'Total Hours', key: 'total_watch_time_hours', width: 12 },
      { header: 'Last Active', key: 'last_active_date', width: 14 },
      { header: 'Status', key: 'weekly_active_status', width: 12 }
    ];
    this.styleHeader(wsActivity);

    users.forEach(user => {
      if (user.user_activity?.length > 0) {
        const activity = user.user_activity[0];
        wsActivity.addRow({
          user_id: user.id,
          email: user.email,
          total_videos_queued: activity.total_videos_queued,
          total_videos_watched: activity.total_videos_watched,
          watch_rate_percentage: activity.watch_rate_percentage,
          total_watch_time_hours: activity.total_watch_time_hours,
          last_active_date: activity.last_active_date,
          weekly_active_status: activity.weekly_active_status
        });
      }
    });

    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filePath = path.join(reportsDir, filename);
    await wb.xlsx.writeFile(filePath);
    console.log(`✅ Generated: ${filename}`);
  }

  // Helper functions
  calculatePlanEndDate(planType, startDate) {
    const endDate = new Date(startDate);
    if (planType === 'YEARLY') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    return endDate;
  }

  styleHeader(sheet) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A90E2' } };
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  }
}

module.exports = DataSyncService;
