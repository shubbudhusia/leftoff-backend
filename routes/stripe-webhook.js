// Stripe Webhook Handler
// Upgrades a user to PREMIUM only when Stripe confirms a completed payment.
// Configure in Stripe Dashboard: Developers → Webhooks → Add endpoint
//   URL:    https://leftoff-backend.onrender.com/api/stripe/webhook
//   Events: checkout.session.completed, customer.subscription.deleted
// Then copy the signing secret into the STRIPE_WEBHOOK_SECRET env var.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabase } = require('../config/supabase');

async function setUserTier(email, updates) {
  const { data: extension } = await supabase
    .from('extensions')
    .select('id')
    .eq('name', 'leftoff')
    .single();

  const { data, error } = await supabase
    .from('extension_users')
    .update(updates)
    .eq('email', email.toLowerCase())
    .eq('extension_id', extension.id)
    .select();

  if (error) throw error;
  return data;
}

module.exports = async function stripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // req.body is the raw Buffer (express.raw middleware) — required
    // for signature verification
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email =
          session.customer_details?.email || session.customer_email;

        if (!email) {
          console.warn('[Stripe Webhook] Completed session has no email:', session.id);
          break;
        }

        console.log('[Stripe Webhook] ✅ Payment completed for:', email);

        await setUserTier(email, {
          tier: 'PREMIUM',
          is_premium: true,
          premium_since: new Date().toISOString(),
          is_in_trial: false,
          trial_end_date: null
        });
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled/expired — downgrade to FREE
        const subscription = event.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (customer.email) {
          console.log('[Stripe Webhook] Subscription ended for:', customer.email);
          await setUserTier(customer.email, {
            tier: 'FREE',
            is_premium: false
          });
        }
        break;
      }

      default:
        // Acknowledge other events without action
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err.message);
    // 500 makes Stripe retry the delivery, so a transient DB error self-heals
    res.status(500).json({ error: err.message });
  }
};
