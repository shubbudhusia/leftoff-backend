// Dodo Payments Webhook Handler (international payments — Merchant of Record)
// Upgrades a user to PREMIUM when Dodo confirms a payment/subscription.
// Configure in Dodo Dashboard: Settings → Webhooks → Add endpoint
//   URL:    https://leftoff-backend.onrender.com/api/dodo/webhook
//   Events: payment.succeeded, subscription.active, subscription.renewed,
//           subscription.cancelled, subscription.expired
// Copy the signing secret (whsec_...) into the DODO_WEBHOOK_SECRET env var.
//
// Dodo follows the Standard Webhooks spec:
//   signature = base64(HMAC-SHA256(base64decode(secret), `${id}.${timestamp}.${body}`))
//   sent in headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<sig>")

const crypto = require('crypto');
const { supabase, getExtensionId } = require('../config/supabase');
const { recordPayment } = require('../services/record-payment');

// Map a USD amount (major units) to the plan it corresponds to.
// Prices: $3/month, $12/year, $19 lifetime. Thresholds sit between the
// tiers so tax added at checkout (up to ~27% VAT) still classifies correctly:
// $12 yearly + 27% = $15.24, below the $16 cut; lifetime starts at $19.
// How many days of Premium a one-time Dodo payment buys (null = lifetime).
// The product id is the reliable signal; the USD amount is the fallback.
// When neither is recognised, grant lifetime so a paying customer is never
// short-changed (and the log line makes it easy to spot).
const DODO_PRODUCT_DAYS = {
  pdt_0Nia81LZIJotADOa5vvjK: 30,   // monthly
  pdt_0Nia8xxoEabDoqSPPU2qh: 365,  // yearly
  pdt_0Nia9LsglG58KmPahazsI: null  // lifetime
};
function dodoAccessDays(data) {
  const blob = JSON.stringify(data || {});
  for (const [id, days] of Object.entries(DODO_PRODUCT_DAYS)) {
    if (blob.includes(id)) return days;
  }
  const amount = extractAmount(data);
  const currency = String((data && data.currency) || 'USD').toUpperCase();
  if (amount !== null && currency === 'USD') {
    const plan = getPlanFromUsd(amount);
    return plan === 'monthly' ? 30 : plan === 'yearly' ? 365 : null;
  }
  console.warn('[Dodo Webhook] ⚠️ Unknown product/amount — granting lifetime');
  return null;
}

function getPlanFromUsd(amount) {
  if (amount <= 10) return 'monthly';
  if (amount <= 16) return 'yearly';
  return 'lifetime';
}

// Dodo reports money in minor units (cents) on most events, but some
// payloads use a major-unit field. Prefer the minor-unit fields we know.
function extractAmount(data) {
  const minor = data?.total_amount ?? data?.amount ?? null;
  if (typeof minor === 'number') return minor / 100;
  return null;
}

function verifySignature(secret, msgId, timestamp, rawBody, signatureHeader) {
  if (!secret || !msgId || !timestamp || !signatureHeader) return false;

  // Reject stale deliveries (>5 min old) to prevent replay attacks
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64'
  );
  const signedContent = `${msgId}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // Header may contain several space-separated signatures: "v1,abc v1,def"
  return signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

const DODO_PLAN = 'dodo';

async function setUserTier(email, updates) {
  const extensionId = await getExtensionId();

  const { data, error } = await supabase
    .from('extension_users')
    .update(updates)
    .eq('email', email.toLowerCase())
    .eq('extension_id', extensionId)
    .select();

  if (error) throw error;
  return data;
}

module.exports = async function dodoWebhook(req, res) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Dodo Webhook] DODO_WEBHOOK_SECRET not configured — ignoring');
    return res.status(503).json({ error: 'Dodo not configured' });
  }

  const rawBody = req.body.toString();
  const valid = verifySignature(
    secret,
    req.headers['webhook-id'],
    req.headers['webhook-timestamp'],
    rawBody,
    req.headers['webhook-signature']
  );

  if (!valid) {
    console.error('[Dodo Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const event = JSON.parse(rawBody);
    const type = event.type || '';
    const email =
      event.data?.customer?.email ||
      event.data?.customer_email ||
      null;

    console.log('[Dodo Webhook] Event:', type, email ? `(${email})` : '');

    const upgradeEvents = ['payment.succeeded', 'subscription.active', 'subscription.renewed'];
    const downgradeEvents = ['subscription.cancelled', 'subscription.expired'];

    if (upgradeEvents.includes(type)) {
      if (!email) {
        console.warn('[Dodo Webhook] Upgrade event has no customer email');
        return res.json({ received: true });
      }

      console.log('[Dodo Webhook] ✅ Payment confirmed for:', email);

      // The Dodo products are one-time payments (not subscriptions), so no
      // cancel/expire event will ever end a monthly or yearly purchase — the
      // access period has to be set here, or a $3 "monthly" buyer would keep
      // Premium forever. subscription.* events (if a subscription product is
      // ever added) still get no end date; their cancel event ends them.
      let expiresAt = null;
      if (type === 'payment.succeeded') {
        const days = dodoAccessDays(event.data);
        if (days !== null) {
          const extensionId = await getExtensionId();
          const { data: current } = await supabase
            .from('extension_users')
            .select('premium_expires_at, is_premium')
            .eq('email', email.toLowerCase())
            .eq('extension_id', extensionId)
            .limit(1);
          const row = current && current[0];
          if (row && row.is_premium && !row.premium_expires_at) {
            expiresAt = null; // already lifetime — never shorten it
          } else {
            // Extend from the later of now or the current end date
            const existing = row && row.premium_expires_at ? Date.parse(row.premium_expires_at) : 0;
            expiresAt = new Date(Math.max(existing, Date.now()) + days * 86400000).toISOString();
          }
        }
      }

      const updated = await setUserTier(email, {
        tier: 'PREMIUM',
        is_premium: true,
        premium_since: new Date().toISOString(),
        is_in_trial: false,
        trial_end_date: null,
        premium_expires_at: expiresAt, // null = lifetime
        premium_plan: DODO_PLAN
      });

      if (!updated || updated.length === 0) {
        console.error('[Dodo Webhook] ❌ PAID BUT NOT UPGRADED — no account for', email, '— run: node update-user.js', email);
      }

      // Revenue history — recorded after the upgrade so a failure here can
      // never cost a paying customer their access. Only payment.succeeded
      // carries a real transaction; subscription.* events are status changes
      // and would otherwise record phantom revenue.
      if (type === 'payment.succeeded') {
        const amount = extractAmount(event.data);
        const txnId = event.data?.payment_id || event.data?.id || req.headers['webhook-id'];

        if (amount === null) {
          console.warn('[Dodo Webhook] ⚠️ Could not read amount — payment not recorded:', txnId);
        } else {
          const currency = (event.data?.currency || 'USD').toUpperCase();
          await recordPayment({
            email,
            gateway: 'dodo',
            transactionId: txnId,
            amount,
            currency,
            plan: currency === 'USD' ? getPlanFromUsd(amount) : null,
            paidAt: event.data?.created_at ? new Date(event.data.created_at) : null,
            raw: event
          });
        }
      }
    } else if (downgradeEvents.includes(type)) {
      if (email) {
        console.log('[Dodo Webhook] Subscription ended for:', email);
        // Only end access that Dodo granted — a user who also holds a
        // Razorpay plan (or lifetime) must not be downgraded by this.
        const extensionId = await getExtensionId();
        const { error: downErr } = await supabase
          .from('extension_users')
          .update({ tier: 'FREE', is_premium: false })
          .eq('email', email.toLowerCase())
          .eq('extension_id', extensionId)
          .eq('premium_plan', DODO_PLAN);
        if (downErr) throw downErr;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Dodo Webhook] Handler error:', err.message);
    // 500 makes Dodo retry the delivery
    res.status(500).json({ error: 'Webhook handler error' });
  }
};
