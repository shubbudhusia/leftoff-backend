// Razorpay Webhook Handler
// Upgrades a user to PREMIUM when Razorpay confirms a captured payment.
// Configure in Razorpay Dashboard: Settings → Webhooks → Add New Webhook
//   URL:    https://leftoff-backend.onrender.com/api/razorpay/webhook
//   Events: payment.captured, payment_link.paid
//   Secret: set any strong secret and copy it to RAZORPAY_WEBHOOK_SECRET env var
//
// Plan detection (amount in paise):
//   ₹29  (2900 paise)  → monthly  → 30 days
//   ₹199 (19900 paise) → yearly   → 365 days
//   ₹499 (49900 paise) → lifetime → permanent (null expiry)
//
// Renewal logic (Option B):
//   New expiry = MAX(current_expiry, now) + plan_days
//   So renewing while still active EXTENDS from current expiry, not from today.

const crypto = require('crypto');
const { supabase, getExtensionId } = require('../config/supabase');

// Map payment amount (paise) → plan info
function getPlanFromAmount(amountPaise) {
  if (amountPaise <= 3000) return { name: 'monthly', days: 30 };
  if (amountPaise <= 20000) return { name: 'yearly', days: 365 };
  // ₹499+ = lifetime
  return { name: 'lifetime', days: null };
}

async function applyPremium(email, amountPaise) {
  const extensionId = await getExtensionId();
  const plan = getPlanFromAmount(amountPaise);

  // Fetch current user so we can extend (not reset) an active subscription
  const { data: users, error: fetchErr } = await supabase
    .from('extension_users')
    .select('premium_expires_at, is_premium')
    .eq('email', email.toLowerCase())
    .eq('extension_id', extensionId)
    .limit(1);

  if (fetchErr) throw fetchErr;
  if (!users || users.length === 0) {
    console.warn('[Razorpay Webhook] ⚠️ No user found for email:', email);
    return null;
  }

  let newExpiry = null; // null = permanent (lifetime)

  if (plan.days !== null) {
    // Option B: start from whichever is later — current expiry or right now
    const existingExpiry = users[0].premium_expires_at
      ? new Date(users[0].premium_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, Date.now());
    newExpiry = new Date(base + plan.days * 24 * 60 * 60 * 1000).toISOString();
  }

  const updatePayload = {
    tier: 'PREMIUM',
    is_premium: true,
    premium_since: users[0].is_premium
      ? undefined  // keep original start date on renewals
      : new Date().toISOString(),
    is_in_trial: false,
    trial_end_date: null,
    premium_expires_at: newExpiry,  // null = lifetime
    premium_plan: plan.name,
  };

  // Remove undefined keys (Supabase rejects them)
  Object.keys(updatePayload).forEach(k => updatePayload[k] === undefined && delete updatePayload[k]);

  const { data, error } = await supabase
    .from('extension_users')
    .update(updatePayload)
    .eq('email', email.toLowerCase())
    .eq('extension_id', extensionId)
    .select();

  if (error) throw error;

  console.log(`[Razorpay Webhook] ✅ ${email} → ${plan.name} (expires: ${newExpiry || 'never'})`);
  return data;
}

module.exports = async function razorpayWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify signature against the RAW body (req.body is a Buffer here)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    console.error('[Razorpay Webhook] Invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    const event = JSON.parse(req.body.toString());
    console.log('[Razorpay Webhook] Event:', event.event);

    if (event.event === 'payment.captured' || event.event === 'payment_link.paid') {
      const payment = event.payload?.payment?.entity;
      const email = payment?.email;
      const amountPaise = payment?.amount || 0;

      if (!email) {
        console.warn('[Razorpay Webhook] Payment has no email:', payment?.id);
        return res.json({ received: true });
      }

      console.log(`[Razorpay Webhook] Payment ₹${amountPaise / 100} for: ${email}`);
      await applyPremium(email, amountPaise);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Razorpay Webhook] Handler error:', err.message);
    // 500 makes Razorpay retry the delivery
    res.status(500).json({ error: err.message });
  }
};
