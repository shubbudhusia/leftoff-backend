// Cloud Sync — saves/restores the user's video history and queue
// so logging in on a reinstall (or another computer) brings everything back.
// Requires the user_sync table (see database-setup.sql).

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// The caller must present BOTH the email and the matching LeftOff ID —
// prevents reading someone else's history knowing only their email
async function verifyUser(email, leftOffId) {
  if (!email || !leftOffId) return null;

  const { data: extension } = await supabase
    .from('extensions')
    .select('id')
    .eq('name', 'leftoff')
    .single();

  const { data: user } = await supabase
    .from('extension_users')
    .select('id, left_off_id')
    .eq('email', email.toLowerCase())
    .eq('extension_id', extension.id)
    .single();

  if (!user || user.left_off_id !== leftOffId) return null;
  return user;
}

// POST /api/sync/save  { email, leftOffId, data: { unfinishedVideos, queueHistory } }
router.post('/save', async (req, res) => {
  try {
    const { email, leftOffId, data } = req.body;

    const user = await verifyUser(email, leftOffId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
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
