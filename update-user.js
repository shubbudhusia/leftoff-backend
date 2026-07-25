// Manual premium grant — for reconciling a payment the webhook missed
// (e.g. the customer paid with a different email than their account).
//
// Usage:  node update-user.js someone@example.com [monthly|yearly|lifetime]
//
// Writes to extension_users, the same table the webhooks and auth flow use.

const { supabase, getExtensionId } = require('./config/supabase');

const PLAN_DAYS = { monthly: 30, yearly: 365, lifetime: null };

async function updateUserToPremium() {
  const email = process.argv[2];
  const plan = (process.argv[3] || 'lifetime').toLowerCase();

  if (!email) {
    console.error('❌ Usage: node update-user.js <email> [monthly|yearly|lifetime]');
    process.exit(1);
  }
  if (!(plan in PLAN_DAYS)) {
    console.error(`❌ Unknown plan "${plan}". Use: monthly, yearly, or lifetime`);
    process.exit(1);
  }

  try {
    const extensionId = await getExtensionId();
    const days = PLAN_DAYS[plan];

    // Extend from the later of the current expiry or now, matching the
    // renewal rule in routes/razorpay-webhook.js
    const { data: existing } = await supabase
      .from('extension_users')
      .select('premium_expires_at, is_premium')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .limit(1);

    if (!existing || existing.length === 0) {
      console.error('❌ No account found for:', email);
      process.exit(1);
    }

    let expiresAt = null; // null = lifetime
    if (days !== null) {
      const current = existing[0].premium_expires_at
        ? new Date(existing[0].premium_expires_at).getTime()
        : 0;
      expiresAt = new Date(Math.max(current, Date.now()) + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const payload = {
      tier: 'PREMIUM',
      is_premium: true,
      is_in_trial: false,
      trial_end_date: null,
      premium_expires_at: expiresAt,
      premium_plan: plan
    };
    if (!existing[0].is_premium) payload.premium_since = new Date().toISOString();

    const { data, error } = await supabase
      .from('extension_users')
      .update(payload)
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .select();

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    console.log('✅ Upgraded to PREMIUM');
    console.log('   Email:  ', data[0].email);
    console.log('   Tier:   ', data[0].tier);
    console.log('   Plan:   ', data[0].premium_plan);
    console.log('   Expires:', data[0].premium_expires_at || 'never (lifetime)');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

updateUserToPremium();
