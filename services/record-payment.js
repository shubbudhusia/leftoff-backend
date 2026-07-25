// Shared payment recorder used by the Razorpay and Dodo webhooks.
//
// Recording revenue must NEVER block granting access: if the insert fails,
// the customer has already paid and must still get Premium. So every failure
// here is logged and swallowed — the caller upgrades the user regardless.
//
// Requires the payments table from migrations/001_payments.sql.

const { supabase, getExtensionId } = require('../config/supabase');

/**
 * @param {object} p
 * @param {string} p.email          Payer email (as sent by the gateway)
 * @param {'razorpay'|'dodo'|'manual'} p.gateway
 * @param {string} p.transactionId  Gateway's payment id — makes retries idempotent
 * @param {number} p.amount         Major units (rupees/dollars), not paise/cents
 * @param {string} p.currency       e.g. 'INR', 'USD'
 * @param {string|null} p.plan      'monthly' | 'yearly' | 'lifetime'
 * @param {Date|null}   p.paidAt
 * @param {object|null} p.raw       Full webhook payload
 */
async function recordPayment({
  email,
  gateway,
  transactionId,
  amount,
  currency,
  plan = null,
  paidAt = null,
  raw = null
}) {
  if (!email || !transactionId) {
    console.warn('[Payments] Skipped record — missing email or transaction id');
    return null;
  }

  try {
    const extensionId = await getExtensionId();

    // Best-effort account link. A payment from an unrecognised email is still
    // recorded (user_id stays null) so the revenue is never lost.
    const { data: users } = await supabase
      .from('extension_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .limit(1);

    const userId = users && users.length > 0 ? users[0].id : null;

    const { error } = await supabase.from('payments').insert({
      user_id: userId,
      email: email.toLowerCase(),
      gateway,
      transaction_id: transactionId,
      amount,
      currency,
      plan,
      status: 'completed',
      paid_at: (paidAt || new Date()).toISOString(),
      raw
    });

    if (error) {
      // 23505 = unique violation → this is a webhook retry of a payment we
      // already stored. Expected and harmless.
      if (error.code === '23505') {
        console.log('[Payments] Duplicate delivery ignored:', gateway, transactionId);
        return null;
      }
      throw error;
    }

    console.log(`[Payments] ✅ Recorded ${currency} ${amount} (${plan || 'unknown plan'}) via ${gateway} for ${email}`);
    if (!userId) {
      console.warn('[Payments] ⚠️ No matching account for', email, '— reconcile with: node update-user.js', email);
    }
    return true;
  } catch (err) {
    console.error('[Payments] Failed to record payment:', err.message);
    return null; // never block the upgrade
  }
}

module.exports = { recordPayment };
