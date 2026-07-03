const express = require('express');
const router = express.Router();

// Use the shared, validated Supabase client
const { supabase } = require('./config/supabase');

// ============ TRACK USER INSTALLATION ============
router.post('/api/track/installation', async (req, res) => {
  try {
    const { email, name, browser, browserVersion, os, referralSource, deviceType, country } = req.body;

    // Check if user already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (!existing) {
      const { data, error } = await supabase.from('users').insert({
        email,
        name: name || email.split('@')[0],
        browser,
        browser_version: browserVersion,
        os,
        referral_source: referralSource,
        device_type: deviceType,
        country: country || 'Unknown',
        installation_date: new Date(),
        extension_version: req.body.extensionVersion || '1.1.0'
      }).select();

      if (error) throw error;

      // Create activity record
      await supabase.from('user_activity').insert({
        user_id: data[0].id,
        total_videos_queued: 0,
        total_videos_watched: 0
      });

      // Initialize trial
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);

      await supabase.from('trial_tracking').insert({
        user_id: data[0].id,
        trial_start_date: new Date(),
        trial_end_date: trialEnd,
        trial_status: 'ACTIVE',
        days_remaining: 7
      });

      return res.json({
        success: true,
        message: 'User installed successfully',
        userId: data[0].id,
        trial_days: 7
      });
    }

    res.json({ success: true, message: 'User already exists' });
  } catch (error) {
    console.error('Installation tracking error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TRACK VIDEO ACTIVITY ============
router.post('/api/track/video-activity', async (req, res) => {
  try {
    const { email, videoId, title, duration, watchedTime, action } = req.body;

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get current activity
    const { data: activity } = await supabase
      .from('user_activity')
      .select('*')
      .eq('user_id', user.id)
      .single();

    let updates = {
      last_active_date: new Date(),
      weekly_active_status: 'ACTIVE'
    };

    if (action === 'added') {
      updates.total_videos_queued = (activity?.total_videos_queued || 0) + 1;
    } else if (action === 'watched') {
      updates.total_videos_watched = (activity?.total_videos_watched || 0) + 1;
      updates.total_watch_time_hours = (activity?.total_watch_time_hours || 0) + (watchedTime / 3600);
    } else if (action === 'abandoned') {
      updates.abandoned_videos = (activity?.abandoned_videos || 0) + 1;
    }

    // Calculate watch rate
    const total = updates.total_videos_queued || activity?.total_videos_queued || 0;
    const watched = updates.total_videos_watched || activity?.total_videos_watched || 0;
    if (total > 0) {
      updates.watch_rate_percentage = (watched / total) * 100;
    }

    // Update activity
    await supabase
      .from('user_activity')
      .update(updates)
      .eq('user_id', user.id);

    // Log event
    await supabase.from('extension_events').insert({
      user_id: user.id,
      event_type: action,
      event_data: {
        videoId,
        title,
        duration,
        watchedTime
      },
      event_date: new Date()
    });

    res.json({ success: true, message: 'Activity tracked' });
  } catch (error) {
    console.error('Activity tracking error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ GET USER DASHBOARD DATA ============
router.get('/api/user/dashboard/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const { data: user } = await supabase
      .from('users')
      .select(`
        *,
        trial_tracking(*),
        user_activity(*),
        payments(*)
      `)
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get latest metrics
    const { data: metrics } = await supabase
      .from('dashboard_metrics')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      user,
      metrics
    });
  } catch (error) {
    console.error('Dashboard error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ GET ADMIN ANALYTICS ============
router.get('/api/admin/analytics', async (req, res) => {
  try {
    // Check admin key
    if (req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Total users
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Indian users
    const { count: indianUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('country', 'India');

    // Premium users
    const { data: premiumUsers } = await supabase
      .from('payments')
      .select('user_id', { distinct: true })
      .eq('payment_status', 'COMPLETED')
      .gt('plan_end_date', new Date().toISOString());

    // Revenue by country
    const { data: payments } = await supabase
      .from('payments')
      .select('user_id, total_paid, currency, payment_gateway, created_at');

    const users = await supabase.from('users').select('id, country');
    const userMap = new Map(users.data.map(u => [u.id, u.country]));

    let revenueByCountry = {};
    let revenueByGateway = {};

    payments.forEach(p => {
      const country = userMap.get(p.user_id) || 'Unknown';
      revenueByCountry[country] = (revenueByCountry[country] || 0) + p.total_paid;
      revenueByGateway[p.payment_gateway] = (revenueByGateway[p.payment_gateway] || 0) + p.total_paid;
    });

    res.json({
      success: true,
      analytics: {
        totalUsers,
        indianUsers,
        premiumUsers: premiumUsers?.length || 0,
        conversionRate: ((premiumUsers?.length || 0) / (totalUsers || 1) * 100).toFixed(2),
        revenueByCountry,
        revenueByGateway,
        totalPayments: payments.length
      }
    });
  } catch (error) {
    console.error('Analytics error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ HEALTH CHECK ============
router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'LeftOff Backend Running',
    timestamp: new Date(),
    features: [
      'User tracking',
      'Video activity monitoring',
      'Payment sync (Razorpay + Stripe)',
      'Daily Excel reports',
      'Dashboard metrics',
      'Admin analytics'
    ]
  });
});

module.exports = router;
