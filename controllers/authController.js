const { supabase, getExtensionId } = require('../config/supabase');
const nodemailer = require('nodemailer');

// ============ TRIAL CONSTANTS ============
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Reminder schedule for the 14-day trial. Keys ('day_5' etc.) are kept as-is —
// they are stored in the reminders_sent DB column and matched by string.
const REMINDER_DAY_5 = 12 * 24 * 60 * 60 * 1000;  // 2 days left
const REMINDER_DAY_7 = 14 * 24 * 60 * 60 * 1000;  // last day
const REMINDER_DAY_8 = 15 * 24 * 60 * 60 * 1000;  // expired

// ============ HELPER FUNCTIONS ============

function generateLeftOffId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'LEFTOFF-';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateVerificationCode() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

function getTrialEndDate() {
  return new Date(Date.now() + TRIAL_DURATION_MS);
}

function getTrialDaysRemaining(trialEndDate) {
  const msRemaining = trialEndDate - Date.now();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

function getRemindersToSend(trialEndDate) {
  const msElapsed = Date.now() - (trialEndDate - TRIAL_DURATION_MS);
  const reminders = [];

  if (msElapsed >= REMINDER_DAY_5 && msElapsed < REMINDER_DAY_5 + (24 * 60 * 60 * 1000)) {
    reminders.push('day_5');
  }
  if (msElapsed >= REMINDER_DAY_7 && msElapsed < REMINDER_DAY_7 + (24 * 60 * 60 * 1000)) {
    reminders.push('day_7');
  }
  if (msElapsed >= REMINDER_DAY_8 && msElapsed < REMINDER_DAY_8 + (24 * 60 * 60 * 1000)) {
    reminders.push('day_8_expired');
  }

  return reminders;
}

// ============ PREMIUM EXPIRY REMINDERS ============
// Covers everyone with a time-limited premium_expires_at — real paid
// monthly/yearly plans AND the Independence Day promo grant. Lifetime
// accounts have premium_expires_at = NULL and are never queried here.
//
// Counts DOWN from the expiry date (days remaining), not up from a start
// date like the trial reminders do — plan lengths vary wildly (30 days,
// 90 days, 365 days), so "days remaining" is the only schedule that works
// the same way for all of them.
const DAY_MS = 24 * 60 * 60 * 1000;

function getPremiumRemindersToSend(expiresAt) {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const reminders = [];

  if (msLeft <= 7 * DAY_MS && msLeft > 6 * DAY_MS) reminders.push('premium_day_7');
  if (msLeft <= 1 * DAY_MS && msLeft > 0) reminders.push('premium_day_1');
  if (msLeft <= 0 && msLeft > -1 * DAY_MS) reminders.push('premium_expired');

  return reminders;
}

// ============ EMAIL SERVICE ============

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  family: 4, // force IPv4 — Render cannot reach Gmail over IPv6
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Render's free tier BLOCKS outbound SMTP (ports 25/465/587), so direct
// Gmail sending always times out there. When BREVO_API_KEY is set we send
// through Brevo's HTTPS API instead (port 443 — never blocked).
// Drop-in replacement for sendEmail(mailOptions, callback).
function sendEmail(mailOptions, callback) {
  const cb = callback || (() => {});

  if (process.env.BREVO_API_KEY) {
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'LeftOff', email: process.env.EMAIL_USER },
        to: [{ email: mailOptions.to }],
        subject: mailOptions.subject,
        htmlContent: mailOptions.html
      })
    })
      .then(async res => {
        if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
        console.log('[Email] ✅ Sent via Brevo to:', mailOptions.to);
        cb(null, { accepted: [mailOptions.to] });
      })
      .catch(err => {
        console.error('[Email] Brevo send failed:', err.message);
        cb(err);
      });
    return;
  }

  // No Brevo key — fall back to SMTP (works locally, not on Render free tier)
  transporter.sendMail(mailOptions, cb);
}

// Send Day 5 reminder email
function sendDay5ReminderEmail(email, name, daysLeft) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: `⏰ Your LeftOff trial ends in ${daysLeft} days!`,
    html: `
      <h2>Hi ${name}! ⏰</h2>
      <p>Your <strong>14-day free trial</strong> expires in <strong>${daysLeft} days</strong>.</p>

      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="margin-top: 0; color: #ff6f00;">Keep Add to Queue & Finish Mode</h3>
        <p>After the trial, Resume still works free — but Premium keeps you queueing videos and using Finish Mode:</p>
        <ul>
          <li>✓ Add to Queue — line up what to watch next</li>
          <li>✓ Finish Mode — distraction-free, one video at a time</li>
          <li>✓ Premium support</li>
        </ul>
      </div>

      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="
          background: #FF0000;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
        ">Get Premium Access</a>
      </p>

      <p style="color: #999; font-size: 12px;">
        Trial expires on ${new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000).toDateString()}
      </p>
    `
  };

  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) {
        console.error('[Day 5 Reminder] Failed:', err);
      } else {
        console.log('[Day 5 Reminder] Sent to:', email);
      }
      resolve();
    });
  });
}

// Send Day 7 reminder email
function sendDay7ReminderEmail(email, name) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '🚨 Last day! Your LeftOff trial expires today',
    html: `
      <h2>Last Chance! 🚨</h2>
      <p>Your <strong>14-day free trial expires TODAY</strong>.</p>

      <div style="background: #ffebee; border-left: 4px solid #FF0000; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="margin-top: 0; color: #c62828;">Act Now!</h3>
        <p>After today, Resume keeps working free — but you'll lose <strong>Add to Queue</strong> and <strong>Finish Mode</strong> until you upgrade.</p>
      </div>

      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h4 style="color: #FF0000; margin-top: 0;">Premium Plans:</h4>
        <p><strong>₹29/month</strong>, <strong>₹199/year</strong> (save 43%) or <strong>₹499 lifetime</strong> 🔥 (limited-time launch price)</p>
      </div>

      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="
          background: #FF0000;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
          font-size: 16px;
        ">Upgrade Now - Limited Time Offer</a>
      </p>

      <p style="color: #999; font-size: 12px; text-align: center;">
        Trial expires today at midnight
      </p>
    `
  };

  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) console.error('[Day 7 Reminder] Failed:', err);
      else console.log('[Day 7 Reminder] Sent to:', email);
      resolve();
    });
  });
}

// Send Trial Expired email
function sendTrialExpiredEmail(email, name) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your trial has ended — Resume still works free',
    html: `
      <h2>Trial Period Ended</h2>
      <p>Hi ${name},</p>
      <p>Your <strong>14-day free trial</strong> has ended. Your account has been switched to <strong>Free mode</strong>.</p>

      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h4>What Still Works on Free:</h4>
        <ul>
          <li>✓ Resume any video — pick up exactly where you left off</li>
          <li>✓ View, search, and sort everything you've saved</li>
          <li>✗ Add to Queue (Premium)</li>
          <li>✗ Finish Mode (Premium)</li>
        </ul>
      </div>

      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h4 style="color: #ff6f00; margin-top: 0;">Upgrade to Premium</h4>
        <p>Get unlimited video tracking and all premium features</p>
      </div>

      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="
          background: #FF0000;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
        ">Upgrade to Premium</a>
      </p>

      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        <strong>Special Offer:</strong> Use code <strong>BACK50</strong> for 50% off Premium
      </p>
    `
  };

  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) console.error('[Trial Expired] Failed:', err);
      else console.log('[Trial Expired] Sent to:', email);
      resolve();
    });
  });
}

// Send 7-days-left Premium expiry reminder
function sendPremiumDay7ReminderEmail(email, name, planLabel) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '⏰ Your LeftOff Premium ends in 7 days',
    html: `
      <h2>Hi ${name || ''}!</h2>
      <p>Your <strong>${planLabel}</strong> ends in <strong>7 days</strong>.</p>
      <p>After that you'll switch to Free mode — Resume still works free (everything you've saved stays there), but Add to Queue and Finish Mode need Premium.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="background:#FF0000;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Renew Premium</a>
      </p>
    `
  };
  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) console.error('[Premium Day 7 Reminder] Failed:', err);
      else console.log('[Premium Day 7 Reminder] Sent to:', email);
      resolve();
    });
  });
}

// Send 1-day-left Premium expiry reminder
function sendPremiumDay1ReminderEmail(email, name, planLabel) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '🚨 Your LeftOff Premium ends tomorrow',
    html: `
      <h2>Last day tomorrow!</h2>
      <p>Hi ${name || ''}, your <strong>${planLabel}</strong> ends <strong>tomorrow</strong>.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="background:#FF0000;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Renew Now</a>
      </p>
    `
  };
  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) console.error('[Premium Day 1 Reminder] Failed:', err);
      else console.log('[Premium Day 1 Reminder] Sent to:', email);
      resolve();
    });
  });
}

// Send Premium-expired notice
function sendPremiumExpiredEmail(email, name, planLabel) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your LeftOff Premium has ended',
    html: `
      <h2>Your ${planLabel} has ended</h2>
      <p>Hi ${name || ''}, you're now on Free mode — Resume still works free (pick up any video exactly where you left off), but Add to Queue and Finish Mode need Premium.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="https://leftoff.com/upgrade" style="background:#FF0000;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Upgrade to Premium</a>
      </p>
    `
  };
  return new Promise((resolve) => {
    sendEmail(mailOptions, (err) => {
      if (err) console.error('[Premium Expired] Failed:', err);
      else console.log('[Premium Expired] Sent to:', email);
      resolve();
    });
  });
}

// ============ AUTH CONTROLLERS ============

exports.signup = async (req, res) => {
  try {
    const { name, email, source } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and email'
      });
    }

    // Get leftoff extension ID (creates the row if missing)
    const extensionId = await getExtensionId();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('extension_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .single();

    if (existingUser) {
      // Existing user (e.g. reinstalled the extension) — treat as a login:
      // send a fresh code by email so they can verify ownership, then the
      // extension restores their ORIGINAL trial/premium state from the server.
      const loginCode = generateVerificationCode();

      await supabase
        .from('extension_users')
        .update({ verification_code: loginCode })
        .eq('id', existingUser.id);

      sendEmail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your LeftOff Login Code',
        html: `
          <h2>Welcome back, ${existingUser.full_name}!</h2>
          <p>Use this code to sign back in to LeftOff:</p>
          <h1 style="letter-spacing: 6px;">${loginCode}</h1>
          <p style="color: #999; font-size: 12px;">
            If you didn't request this, you can ignore this email.
          </p>
        `
      }, (err) => {
        if (err) console.error('Login code email failed:', err);
      });

      return res.status(200).json({
        success: true,
        existing: true,
        message: 'Welcome back! We emailed you a login code.',
        data: {
          leftOffId: existingUser.left_off_id,
          email: existingUser.email
        }
      });
    }

    // Generate LeftOff ID and verification code
    const leftOffId = generateLeftOffId();
    const verificationCode = generateVerificationCode();

    // "Try first, sign up later": if this device already ran an anonymous
    // trial, the account INHERITS those original dates — signing up never
    // grants a second 14 days. No device record = normal fresh trial.
    let trialStartDate = new Date();
    let trialEndDate = getTrialEndDate();
    const { fingerprint } = req.body;

    if (typeof fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(fingerprint)) {
      const { data: device } = await supabase
        .from('trial_devices')
        .select('trial_start_date, trial_end_date')
        .eq('fingerprint', fingerprint)
        .single();

      if (device) {
        trialStartDate = new Date(device.trial_start_date);
        trialEndDate = new Date(device.trial_end_date);
        // Link the device to this account for analytics/anti-abuse
        supabase
          .from('trial_devices')
          .update({ converted_email: email.toLowerCase(), updated_at: new Date() })
          .eq('fingerprint', fingerprint)
          .then(() => {}, (e) => console.error('[Signup] Device link failed:', e.message));
        console.log('[Signup] Inherited device trial dates for', email);
      }
    }

    // Create new user
    const { data: newUser, error: insertError } = await supabase
      .from('extension_users')
      .insert([
        {
          extension_id: extensionId,
          full_name: name,
          email: email.toLowerCase(),
          left_off_id: leftOffId,
          verification_code: verificationCode,
          tier: 'TRIAL',
          trial_start_date: trialStartDate,
          trial_end_date: trialEndDate,
          is_in_trial: trialEndDate.getTime() > Date.now(),
          is_premium: false
        }
      ])
      .select();

    if (insertError) {
      return res.status(500).json({
        success: false,
        message: 'Error creating user',
        error: insertError.message
      });
    }

    // Send verification email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'LeftOff Account Verification Code',
      html: `
        <h2>Welcome to LeftOff, ${name}!</h2>
        <p>Your account has been created. Here are your details:</p>

        <div style="background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>LeftOff ID:</strong> ${leftOffId}</p>
          <p><strong>Verification Code:</strong> <h3>${verificationCode}</h3></p>
        </div>

        <p>Enter this code in the LeftOff extension to verify your account.</p>
        <p>This code will expire in 24 hours.</p>

        <p style="color: #999; font-size: 12px;">
          If you didn't create this account, please ignore this email.
        </p>
      `
    };

    sendEmail(mailOptions, (err) => {
      if (err) {
        console.error('Email sending failed:', err);
      } else {
        console.log('✅ Verification email sent to:', email);
      }
    });

    console.log('[Signup] User registered:', {
      name: name,
      email: email,
      leftOffId: leftOffId
    });

    // SECURITY: never return the verification code to the client —
    // the email is the only delivery channel, that's what makes it verification
    res.status(201).json({
      success: true,
      existing: false,
      message: 'Account created. Verification email sent.',
      data: {
        leftOffId: leftOffId,
        email: email
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during signup',
      error: error.message
    });
  }
};

exports.verifyCode = async (req, res) => {
  try {
    const { email, verificationCode } = req.body;

    if (!email || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Email and verification code required'
      });
    }

    // Get leftoff extension ID (creates the row if missing)
    const extensionId = await getExtensionId();

    // Find user
    const { data: user, error: selectError } = await supabase
      .from('extension_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check verification code
    if (user.verification_code !== verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Update user
    const { error: updateError } = await supabase
      .from('extension_users')
      .update({
        email_verified: true,
        verification_code: null
      })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Error verifying email',
        error: updateError.message
      });
    }

    // Send confirmation email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'LeftOff Account Verified ✅',
      html: `
        <h2>Account Verified!</h2>
        <p>Hi ${user.full_name},</p>
        <p>Your LeftOff account is now verified and ready to use.</p>
        <p>You can now start tracking your YouTube videos!</p>

        <p style="color: #999; font-size: 12px;">
          Your LeftOff ID: ${user.left_off_id}
        </p>
      `
    };

    sendEmail(mailOptions, (err) => {
      if (err) console.error('Confirmation email failed:', err);
    });

    console.log('[Verify] User verified:', email);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: {
          fullName: user.full_name,
          email: user.email,
          leftOffId: user.left_off_id,
          tier: user.tier,
          isPremium: user.is_premium,
          isInTrial: user.is_in_trial,
          trialStartDate: user.trial_start_date,
          trialEndDate: user.trial_end_date,
          emailVerified: true
        }
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
};

exports.getUser = async (req, res) => {
  try {
    const extensionId = await getExtensionId();

    const { data: user, error } = await supabase
      .from('extension_users')
      .select('*')
      .eq('email', req.params.email.toLowerCase())
      .eq('extension_id', extensionId)
      .single();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Server-side expiry enforcement: if a monthly/yearly sub expired, downgrade now
    if (
      user.is_premium &&
      user.premium_expires_at !== null &&
      new Date(user.premium_expires_at).getTime() < Date.now()
    ) {
      console.log(`[GetUser] Premium expired for ${user.email} — downgrading to FREE`);
      await supabase
        .from('extension_users')
        .update({ tier: 'FREE', is_premium: false, is_in_trial: false })
        .eq('id', user.id);

      user.tier = 'FREE';
      user.is_premium = false;
      user.is_in_trial = false;
    }

    res.status(200).json({
      success: true,
      data: {
        // NOTE: left_off_id is deliberately NOT returned here. This endpoint is
        // public (no auth), and left_off_id is the credential that protects
        // /api/sync. Leaking it for any email would let anyone read another
        // user's synced history. The extension gets its own id from signup/verify.
        fullName: user.full_name,
        email: user.email,
        tier: user.tier,
        isPremium: user.is_premium,
        isInTrial: user.is_in_trial,
        trialStartDate: user.trial_start_date,
        trialEndDate: user.trial_end_date,
        emailVerified: user.email_verified,
        premiumExpiresAt: user.premium_expires_at || null,
        premiumPlan: user.premium_plan || null,
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching user', error: error.message });
  }
};

exports.resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    // Get leftoff extension ID (creates the row if missing)
    const extensionId = await getExtensionId();

    const { data: user } = await supabase
      .from('extension_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Note: verified users may also request a code (login after reinstall)

    // Generate new code
    const newCode = generateVerificationCode();

    const { error: updateError } = await supabase
      .from('extension_users')
      .update({ verification_code: newCode })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Error updating code'
      });
    }

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'LeftOff Verification Code (Resent)',
      html: `
        <h2>New Verification Code</h2>
        <p>Your new verification code is:</p>
        <h3>${newCode}</h3>
      `
    };

    sendEmail(mailOptions, (err) => {
      if (err) console.error('Resend failed:', err);
    });

    // SECURITY: never return the code to the client
    res.status(200).json({
      success: true,
      message: 'Verification code resent'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resending code',
      error: error.message
    });
  }
};

// ============ TRIAL REMINDER PROCESSOR ============

exports.processTrialReminders = async (req, res) => {
  try {
    console.log('[Trial Reminders] Processing started...');

    // Get all users with trials
    const { data: users, error: selectError } = await supabase
      .from('extension_users')
      .select('*')
      .neq('trial_end_date', null);

    if (selectError) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching users'
      });
    }

    console.log(`[Trial Reminders] Found ${users.length} users to check`);

    for (const user of users) {
      if (!user.trial_end_date) continue;

      const trialEndDate = new Date(user.trial_end_date);
      const remindersToSend = getRemindersToSend(trialEndDate);
      const sent = user.reminders_sent || [];

      for (const reminder of remindersToSend) {
        if (sent.includes(reminder)) continue;

        console.log(`[Trial Reminders] Sending ${reminder} to ${user.email}`);

        if (reminder === 'day_5') {
          const daysLeft = getTrialDaysRemaining(trialEndDate);
          await sendDay5ReminderEmail(user.email, user.full_name, daysLeft);
        } else if (reminder === 'day_7') {
          await sendDay7ReminderEmail(user.email, user.full_name);
        } else if (reminder === 'day_8_expired') {
          await sendTrialExpiredEmail(user.email, user.full_name);

          // Update tier to FREE if still in TRIAL
          if (user.tier === 'TRIAL') {
            await supabase
              .from('extension_users')
              .update({
                tier: 'FREE',
                is_in_trial: false
              })
              .eq('id', user.id);
          }
        }

        // Mark reminder as sent
        const updatedReminders = [...sent, reminder];
        await supabase
          .from('extension_users')
          .update({ reminders_sent: updatedReminders })
          .eq('id', user.id);
      }
    }

    // Same pass, second query: everyone with a time-limited premium plan —
    // real paid monthly/yearly customers AND Independence Day promo grants.
    // Riding on this same processor (and its existing daily cron trigger)
    // rather than a separate endpoint, so no new cron needs to be set up.
    const { data: premiumUsers, error: premiumSelectError } = await supabase
      .from('extension_users')
      .select('*')
      .not('premium_expires_at', 'is', null)
      .eq('is_premium', true);

    if (premiumSelectError) throw premiumSelectError;

    const PLAN_LABELS = {
      independence_2026: 'free Independence Day Premium',
      monthly: 'Monthly Premium plan',
      yearly: 'Yearly Premium plan'
    };

    console.log(`[Premium Reminders] Found ${premiumUsers.length} time-limited premium users to check`);

    for (const user of premiumUsers) {
      const remindersToSend = getPremiumRemindersToSend(user.premium_expires_at);
      const sent = user.reminders_sent || [];
      const planLabel = PLAN_LABELS[user.premium_plan] || 'Premium plan';

      for (const reminder of remindersToSend) {
        if (sent.includes(reminder)) continue;

        console.log(`[Premium Reminders] Sending ${reminder} to ${user.email}`);

        if (reminder === 'premium_day_7') {
          await sendPremiumDay7ReminderEmail(user.email, user.full_name, planLabel);
        } else if (reminder === 'premium_day_1') {
          await sendPremiumDay1ReminderEmail(user.email, user.full_name, planLabel);
        } else if (reminder === 'premium_expired') {
          await sendPremiumExpiredEmail(user.email, user.full_name, planLabel);

          // Proactive downgrade — don't wait for the user to open the
          // extension and trigger getUser's own inline expiry check.
          if (user.is_premium) {
            await supabase
              .from('extension_users')
              .update({ tier: 'FREE', is_premium: false, is_in_trial: false })
              .eq('id', user.id);
          }
        }

        const updatedReminders = [...sent, reminder];
        await supabase
          .from('extension_users')
          .update({ reminders_sent: updatedReminders })
          .eq('id', user.id);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Trial and premium-expiry reminders processed',
      usersProcessed: users.length,
      premiumUsersProcessed: premiumUsers.length
    });

  } catch (error) {
    console.error('[Trial Reminders] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing trial reminders',
      error: error.message
    });
  }
};

// ============ UPGRADE TO PREMIUM ============

exports.upgradeToPremium = async (req, res) => {
  try {
    // SECURITY: admin-only. Real payments upgrade users via the Stripe
    // webhook (/api/stripe/webhook) — never via a client-callable endpoint.
    if (req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log('[Premium Upgrade] Upgrading user:', email);

    // Get leftoff extension ID (creates the row if missing)
    const extensionId = await getExtensionId();

    // Update user to premium in Supabase
    const { data, error } = await supabase
      .from('extension_users')
      .update({
        tier: 'PREMIUM',
        is_premium: true,
        premium_since: new Date().toISOString(),
        trial_end_date: null,
        is_in_trial: false
      })
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .select();

    if (error) {
      console.error('[Premium Upgrade] Error:', error);
      return res.status(400).json({
        success: false,
        message: 'Error upgrading to premium',
        error: error.message
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('[Premium Upgrade] ✅ User upgraded to premium:', email);

    // Send success email
    sendPremiumWelcomeEmail(email, data[0].full_name || 'User');

    res.json({
      success: true,
      message: 'User upgraded to premium successfully',
      user: {
        email: data[0].email,
        tier: data[0].tier,
        isPremium: data[0].is_premium,
        leftOffId: data[0].left_off_id
      }
    });

  } catch (error) {
    console.error('[Premium Upgrade] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error upgrading to premium',
      error: error.message
    });
  }
};

// ============ INDEPENDENCE DAY OFFER (India-only, 90 days free) ============

const INDEPENDENCE_OFFER_START = new Date('2026-08-04T00:00:00+05:30');
const INDEPENDENCE_OFFER_END = new Date('2026-08-15T23:59:59+05:30');
const INDEPENDENCE_OFFER_DAYS = 90;
const INDEPENDENCE_OFFER_PLAN = 'independence_2026';

// Free, keyless, HTTPS geo-IP lookup. Low volume (marketing promo on a
// ~76-install extension) so a third-party API is fine — no need to ship a
// local GeoIP database for this.
async function lookupCountry(ip) {
  try {
    const resp = await fetch(`https://ipwho.is/${ip}`);
    const data = await resp.json();
    if (!data.success) return null;
    return data.country_code || null; // e.g. 'IN'
  } catch (err) {
    console.error('[Independence Offer] Geo-IP lookup failed:', err.message);
    return null;
  }
}

function getRequestIp(req) {
  // x-forwarded-for can be a comma-separated chain; the first entry is the
  // original client. req.ip already resolves this correctly once
  // app.set('trust proxy', true) is set, but fall back just in case.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip;
}

exports.redeemIndependenceOffer = async (req, res) => {
  try {
    const now = new Date();
    if (now < INDEPENDENCE_OFFER_START || now > INDEPENDENCE_OFFER_END) {
      return res.status(400).json({
        success: false,
        message: 'This offer is only available until Aug 15.'
      });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const ip = getRequestIp(req);
    const country = await lookupCountry(ip);

    if (country !== 'IN') {
      return res.status(403).json({
        success: false,
        message: 'This Independence Day offer is only available for users in India.'
      });
    }

    const extensionId = await getExtensionId();
    const { data: users, error: fetchErr } = await supabase
      .from('extension_users')
      .select('id, full_name, is_premium, premium_expires_at, premium_plan, email_verified')
      .eq('email', email.toLowerCase())
      .eq('extension_id', extensionId)
      .limit(1);

    if (fetchErr) throw fetchErr;
    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No LeftOff account found for this email — sign up first, then redeem the offer.'
      });
    }

    const user = users[0];

    // The real ownership proof: signup() creates a row immediately, before
    // the emailed verification code is ever entered — without this check,
    // anyone could POST an email they don't own and claim Premium on it.
    // IP geolocation alone proves a request came from India, not that the
    // requester controls this inbox.
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email first — check your inbox for the code, then try again.'
      });
    }

    if (user.premium_plan === INDEPENDENCE_OFFER_PLAN) {
      return res.status(400).json({
        success: false,
        message: 'You already redeemed this offer.'
      });
    }

    // Someone already on Premium (paid, or manually granted) must be turned
    // away here, not silently modified below. A manually-granted permanent
    // account has premium_expires_at = NULL, same as "no plan yet" — without
    // this check, claiming would set a 90-day expiry on an account that
    // previously had none, turning permanent access into a countdown.
    if (user.is_premium) {
      return res.status(400).json({
        success: false,
        message: 'You already have Premium — this offer is for trial/free users.'
      });
    }

    // Extend from current expiry if they're already Premium and it's later
    // than now (Option B, same rule the Razorpay webhook uses) — otherwise
    // 90 days from today.
    const existingExpiry = user.premium_expires_at
      ? new Date(user.premium_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, Date.now());
    const newExpiry = new Date(base + INDEPENDENCE_OFFER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // .neq() on the write closes the TOCTOU gap between the read above and
    // this write — two rapid duplicate requests (double-click, retry) can't
    // both pass, because only the first one still finds a non-matching row
    // to update. The second gets back zero rows and is treated as "already
    // redeemed" below, instead of both silently succeeding.
    const { data: updated, error: updateErr } = await supabase
      .from('extension_users')
      .update({
        tier: 'PREMIUM',
        is_premium: true,
        premium_since: user.is_premium ? undefined : new Date().toISOString(),
        is_in_trial: false,
        trial_end_date: null,
        premium_expires_at: newExpiry,
        premium_plan: INDEPENDENCE_OFFER_PLAN
      })
      .eq('id', user.id)
      // Plain .neq() would silently exclude every row where premium_plan is
      // NULL (SQL: NULL != 'x' evaluates to NULL, not true) — which is
      // nearly everyone, since no one has redeemed anything yet. Needs to
      // match "not this promo" OR "no plan at all".
      .or(`premium_plan.neq.${INDEPENDENCE_OFFER_PLAN},premium_plan.is.null`)
      .select();

    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You already redeemed this offer.'
      });
    }

    console.log(`[Independence Offer] ✅ ${email} → Premium until ${newExpiry}`);

    sendEmail({
      from: process.env.EMAIL_USER,
      to: email,
      // No flag emoji — Outlook and other Windows mail clients render
      // flag-sequence emoji as literal letters ("IN") instead of a flag.
      subject: 'Happy Independence Day — 90 days of LeftOff Premium, on us!',
      html: `
        <h2>Happy Independence Day, ${user.full_name || ''}!</h2>
        <p>You now have <strong>90 days of LeftOff Premium</strong> — completely free.</p>
        <p>Premium is active until <strong>${new Date(newExpiry).toDateString()}</strong>.</p>
        <p>No card, no catch. Enjoy!</p>
      `
    }, () => {});

    res.status(200).json({
      success: true,
      message: '90 days of Premium unlocked!',
      premiumExpiresAt: newExpiry
    });

  } catch (error) {
    console.error('[Independence Offer] Error:', error);
    res.status(500).json({ success: false, message: 'Error redeeming offer', error: error.message });
  }
};

// Send premium welcome email
function sendPremiumWelcomeEmail(email, name) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '🎉 Welcome to LeftOff Premium!',
    html: `
      <h2>Welcome to LeftOff Premium, ${name}! 🎉</h2>
      <p>Thank you for upgrading to LeftOff Premium. You now have access to all premium features:</p>

      <div style="background: #f5f5f5; border-left: 4px solid #FF0000; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="color: #FF0000; margin-top: 0;">Your Premium Benefits:</h3>
        <ul>
          <li>✓ Unlimited videos (no limits)</li>
          <li>✓ Bulk delete & auto-delete</li>
          <li>✓ Never lose your progress</li>
          <li>✓ Cloud backup &amp; sync</li>
          <li>✓ Priority support</li>
        </ul>
      </div>

      <p>Start using LeftOff Premium now and enjoy unlimited video tracking!</p>

      <p style="color: #999; font-size: 12px;">
        If you have any questions, feel free to contact us at ${process.env.EMAIL_USER}
      </p>
    `
  };

  // Send email asynchronously (don't wait for response)
  sendEmail(mailOptions, (err, info) => {
    if (err) {
      console.log('[Premium Email] Error sending email:', err.message);
    } else {
      console.log('[Premium Email] ✅ Sent to:', email);
    }
  });
}

module.exports = exports;
