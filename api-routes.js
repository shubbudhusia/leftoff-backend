const express = require('express');
const router = express.Router();

// Use the shared, validated Supabase client
const { supabase, getExtensionId } = require('./config/supabase');

// ============ GET ADMIN ANALYTICS ============
// Reads the tables the app actually writes to (extension_users, trial_devices).
// The previous version queried a 'users'/'payments' schema that was never
// wired up by any real signup or webhook flow, so it always crashed.
router.get('/api/admin/analytics', async (req, res) => {
  try {
    // Check admin key
    if (req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const extensionId = await getExtensionId();

    const [
      { data: users, error: usersErr },
      { data: devices, error: devicesErr },
      { data: payments, error: paymentsErr },
      { data: uninstalls, error: uninstallsErr }
    ] = await Promise.all([
      supabase.from('extension_users').select('*').eq('extension_id', extensionId),
      supabase.from('trial_devices').select('created_at, converted_email'),
      supabase.from('payments').select('amount, currency, gateway, plan, paid_at'),
      supabase.from('uninstall_feedback').select('reason, details, created_at')
    ]);

    if (usersErr) throw usersErr;
    if (devicesErr) throw devicesErr;
    // The payments table is optional: if the migration hasn't been run yet,
    // report the rest of the analytics rather than failing the whole request.
    if (paymentsErr) {
      console.warn('[Analytics] payments table unavailable:', paymentsErr.message);
    }
    if (uninstallsErr) {
      console.warn('[Analytics] uninstall_feedback table unavailable:', uninstallsErr.message);
    }

    const totalSignups = users.length;
    const verifiedUsers = users.filter(u => u.email_verified).length;
    const premiumUsers = users.filter(u => u.is_premium).length;
    const trialUsers = users.filter(u => u.tier === 'TRIAL' && u.is_in_trial).length;
    const freeUsers = users.filter(u => u.tier === 'FREE' && !u.is_premium).length;

    const premiumByPlan = {};
    users.filter(u => u.is_premium).forEach(u => {
      const plan = u.premium_plan || 'unknown';
      premiumByPlan[plan] = (premiumByPlan[plan] || 0) + 1;
    });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const signupsLast7Days = users.filter(u => u.created_at && (now - new Date(u.created_at).getTime()) < 7 * DAY).length;
    const signupsLast30Days = users.filter(u => u.created_at && (now - new Date(u.created_at).getTime()) < 30 * DAY).length;

    // Anonymous device trials = raw installs (no signup required to try LeftOff)
    const totalDeviceTrials = devices.length;
    const devicesConverted = devices.filter(d => d.converted_email).length;
    const deviceTrialsLast7Days = devices.filter(d => d.created_at && (now - new Date(d.created_at).getTime()) < 7 * DAY).length;

    // Revenue. Currencies are reported separately — summing INR and USD into
    // a single number would be meaningless without an FX rate.
    const pay = payments || [];
    const revenueByCurrency = {};
    const revenueByGateway = {};
    const revenueLast30DaysByCurrency = {};
    pay.forEach(p => {
      const cur = p.currency || 'UNKNOWN';
      const amt = Number(p.amount) || 0;
      revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + amt;
      revenueByGateway[p.gateway] = (revenueByGateway[p.gateway] || 0) + amt;
      if (p.paid_at && (now - new Date(p.paid_at).getTime()) < 30 * DAY) {
        revenueLast30DaysByCurrency[cur] = (revenueLast30DaysByCurrency[cur] || 0) + amt;
      }
    });
    const round2 = obj => Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100])
    );

    res.json({
      success: true,
      analytics: {
        // Signed-up accounts
        totalSignups,
        verifiedUsers,
        trialUsers,
        freeUsers,
        premiumUsers,
        premiumByPlan,
        signupConversionRate: totalSignups > 0 ? ((premiumUsers / totalSignups) * 100).toFixed(2) : '0.00',
        signupsLast7Days,
        signupsLast30Days,
        // Anonymous "try first" device trials (broader funnel — includes people who never signed up)
        totalDeviceTrials,
        devicesConverted,
        deviceToSignupRate: totalDeviceTrials > 0 ? ((devicesConverted / totalDeviceTrials) * 100).toFixed(2) : '0.00',
        deviceTrialsLast7Days,
        // Revenue (null if the payments migration hasn't been run yet)
        payments: paymentsErr ? null : {
          totalPayments: pay.length,
          revenueByCurrency: round2(revenueByCurrency),
          revenueByGateway: round2(revenueByGateway),
          revenueLast30DaysByCurrency: round2(revenueLast30DaysByCurrency)
        },
        // Uninstall feedback (null if the migration hasn't been run yet)
        uninstallFeedback: uninstallsErr ? null : {
          totalResponses: uninstalls.length,
          byReason: uninstalls.reduce((acc, u) => {
            acc[u.reason] = (acc[u.reason] || 0) + 1;
            return acc;
          }, {}),
          // Most recent free-text comments, newest first — the qualitative
          // detail that raw counts can't give you
          recentComments: uninstalls
            .filter(u => u.details)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10)
            .map(u => ({ reason: u.reason, details: u.details }))
        }
      }
    });
  } catch (error) {
    console.error('Analytics error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ UNINSTALL FEEDBACK ============
// Called by public/uninstall.html — the page Chrome opens automatically
// right after someone uninstalls (chrome.runtime.setUninstallURL). No auth:
// the extension is already gone by the time this fires, so there's no
// logged-in user to authenticate as. No personal data is collected.
const VALID_UNINSTALL_REASONS = [
  'not_working',
  'privacy_concern',
  'trial_ended',
  'found_alternative',
  'no_longer_needed',
  'other'
];

router.post('/api/uninstall-feedback', async (req, res) => {
  try {
    const { reason, details, extensionVersion } = req.body || {};

    if (!VALID_UNINSTALL_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, error: 'Invalid reason' });
    }

    const { error } = await supabase.from('uninstall_feedback').insert({
      reason,
      details: typeof details === 'string' ? details.slice(0, 1000) : null,
      extension_version: typeof extensionVersion === 'string' ? extensionVersion.slice(0, 20) : null
    });

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Uninstall feedback error:', error.message);
    // Still return success — a failed write here should never surface as an
    // error to someone who already uninstalled and is just trying to help.
    res.json({ success: true });
  }
});

// ============ HEALTH CHECK ============
router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'LeftOff Backend Running',
    timestamp: new Date(),
    features: [
      'Signup + email verification',
      'Anonymous device trials',
      'Payment webhooks (Razorpay + Dodo)',
      'Cloud history sync',
      'Admin analytics'
    ]
  });
});

module.exports = router;
