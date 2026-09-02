// Cloud Sync — saves/restores the user's video history and queue
// so logging in on a reinstall (or another computer) brings everything back.
// Requires the user_sync table (see database-setup.sql).

const express = require('express');
const router = express.Router();
const { supabase, getExtensionId } = require('../config/supabase');

// The caller must present BOTH the email and the matching LeftOff ID —
// prevents reading someone else's history knowing only their email
async function verifyUser(email, leftOffId) {
  if (!email || !leftOffId) return null;

  const extensionId = await getExtensionId();

  const { data: user } = await supabase
    .from('extension_users')
    .select('id, left_off_id, is_premium, premium_expires_at, tier, trial_end_date')
    .eq('email', email.toLowerCase())
    .eq('extension_id', extensionId)
    .single();

  if (!user || user.left_off_id !== leftOffId) return null;
  return user;
}

// Cloud sync is a paid feature (see FEATURES.md / the upgrade modal's
// "Cloud backup & sync" line). This is the ONLY check that actually matters —
// client-side gates can be bypassed by anyone calling this endpoint directly,
// so a stale/self-reported isPremium flag from the extension must never be
// trusted here. Mirrors the real-time expiry check used elsewhere
// (authController.js) rather than trusting a possibly-stale is_premium flag.
function hasSyncAccess(user) {
  const premiumActive = user.is_premium &&
    (user.premium_expires_at === null || new Date(user.premium_expires_at).getTime() > Date.now());
  const trialActive = user.tier === 'TRIAL' &&
    !!user.trial_end_date && new Date(user.trial_end_date).getTime() > Date.now();
  return premiumActive || trialActive;
}

// POST /api/sync/save  { email, leftOffId, data: { unfinishedVideos, queueHistory } }
router.post('/save', async (req, res) => {
  try {
    const { email, leftOffId, data } = req.body;

    const user = await verifyUser(email, leftOffId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!hasSyncAccess(user)) {
      return res.status(403).json({ success: false, message: 'Cloud sync requires Premium or an active trial' });
    }

    const { error } = await supabase
      .from('user_sync')
      .upsert(
        {
          email: email.toLowerCase(),
          left_off_id: leftOffId,
          data: data || {},
          updated_at: new Date().toISOString()
        },
        { onConflict: 'email' }
      );

    if (error) throw error;

    console.log('[Sync] Saved history for:', email);
    res.json({ success: true, message: 'History saved' });
  } catch (err) {
    console.error('[Sync] Save error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sync/load  { email, leftOffId }
router.post('/load', async (req, res) => {
  try {
    const { email, leftOffId } = req.body;

    const user = await verifyUser(email, leftOffId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!hasSyncAccess(user)) {
      return res.status(403).json({ success: false, message: 'Cloud sync requires Premium or an active trial' });
    }

    const { data: row } = await supabase
      .from('user_sync')
      .select('data, updated_at')
      .eq('email', email.toLowerCase())
      .single();

    console.log('[Sync] Loaded history for:', email, row ? '(found)' : '(none)');
    res.json({
      success: true,
      data: row ? row.data : null,
      updatedAt: row ? row.updated_at : null
    });
  } catch (err) {
    console.error('[Sync] Load error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
