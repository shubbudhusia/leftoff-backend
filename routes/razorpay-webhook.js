// Razorpay Webhook Handler
// Upgrades a user to PREMIUM only when Razorpay confirms a captured payment.
// Configure in Razorpay Dashboard: Settings → Webhooks → Add New Webhook
//   URL:    https://leftoff-backend.onrender.com/api/razorpay/webhook
//   Events: payment.captured, payment_link.paid
//   Secret: set any strong secret and copy it to RAZORPAY_WEBHOOK_SECRET env var

const crypto = require('crypto');
const { supabase, getExtensionId } = require('../config/supabase');

async function setUserPremium(email) {
  const extensionId = await getExtensionId();

  const { data, error } = await supabase
    .from('extension_users')
    .update({
      tier: 'PREMIUM',
      is_premium: true,
      premium_since: new Date().toISOString(),
      is_in_trial: false,
      trial_end_date: null
    })
    .eq('email', email.toLowerCase())
    .eq('extension_id', extensionId)
    .select();

  if (error) throw error;
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

      if (!email) {
        console.warn('[Razorpay Webhook] Payment has no email:', payment?.id);
        return res.json({ received: true });
      }

      console.log('[Razorpay Webhook] ✅ Payment captured for:', email);
      const updated = await setUserPremium(email);

      if (!updated || updated.length === 0) {
        // Payment email didn't match a registered user — log it so you can
        // reconcile manually (user may have paid with a different email)
        console.warn('[Razorpay Webhook] ⚠️ No user found for paid email:', email);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Razorpay Webhook] Handler error:', err.message);
    // 500 makes Razorpay retry the delivery
    res.status(500).json({ error: err.message });
  }
};
