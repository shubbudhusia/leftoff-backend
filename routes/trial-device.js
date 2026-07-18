const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// Must match TRIAL_DURATION_MS in authController.js
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

function daysRemaining(endDate) {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

// POST /api/trial/device
// The extension calls this on startup with an anonymous device fingerprint.
// Server-authoritative: the FIRST recorded trial dates for a fingerprint
// always win — reinstalling or wiping local storage never resets the clock.
router.post('/device', async (req, res) => {
  try {
    const { fingerprint, extensionVersion } = req.body;

    // A SHA-256 hex hash is exactly 64 chars; reject anything else so the
    // table can't be polluted with junk or oversized values.
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
      return res.status(400).json({ success: false, message: 'Invalid fingerprint' });
    }

    const { data: existing } = await supabase
      .from('trial_devices')
      .select('trial_start_date, trial_end_date, check_count')
      .eq('fingerprint', fingerprint)
      .single();

    if (existing) {
      // Known device — return the ORIGINAL dates, never a fresh trial.
      supabase
        .from('trial_devices')
        .update({
          last_seen: new Date(),
          check_count: (existing.check_count || 0) + 1,
          extension_version: extensionVersion || null,
          updated_at: new Date()
        })
        .eq('fingerprint', fingerprint)
        .then(() => {}, (e) => console.error('[TrialDevice] last_seen update failed:', e.message));

      const remaining = daysRemaining(existing.trial_end_date);
      return res.json({
        success: true,
        trialStartDate: existing.trial_start_date,
        trialEndDate: existing.trial_end_date,
        daysRemaining: remaining,
        status: remaining > 0 ? 'ACTIVE' : 'EXPIRED'
      });
    }

    // New device — start its one and only anonymous trial.
    const now = new Date();
    const endDate = new Date(now.getTime() + TRIAL_DURATION_MS);

    const { error: insertError } = await supabase.from('trial_devices').insert({
      fingerprint,
      trial_start_date: now,
      trial_end_date: endDate,
      extension_version: extensionVersion || null
    });

    // Unique-constraint race (two startups at once): fall back to reading
    // the row the other request created, so both get identical dates.
    if (insertError) {
      const { data: raced } = await supabase
        .from('trial_devices')
        .select('trial_start_date, trial_end_date')
        .eq('fingerprint', fingerprint)
        .single();

      if (raced) {
        const remaining = daysRemaining(raced.trial_end_date);
        return res.json({
          success: true,
          trialStartDate: raced.trial_start_date,
          trialEndDate: raced.trial_end_date,
          daysRemaining: remaining,
          status: remaining > 0 ? 'ACTIVE' : 'EXPIRED'
        });
      }
      throw new Error(insertError.message);
    }

    return res.json({
      success: true,
      trialStartDate: now,
      trialEndDate: endDate,
      daysRemaining: 14,
      status: 'ACTIVE'
    });
  } catch (err) {
    console.error('[TrialDevice] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
