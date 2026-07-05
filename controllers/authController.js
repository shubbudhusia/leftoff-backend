const { supabase, getExtensionId } = require('../config/supabase');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

// ============ TRIAL CONSTANTS ============
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDER_DAY_5 = 5 * 24 * 60 * 60 * 1000;
const REMINDER_DAY_7 = 7 * 24 * 60 * 60 * 1000;
const REMINDER_DAY_8 = 8 * 24 * 60 * 60 * 1000;

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
      <p>Your <strong>7-day free trial</strong> expires in <strong>${daysLeft} days</strong>.</p>

      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="margin-top: 0; color: #ff6f00;">Unlock Unlimited Video Tracking</h3>
        <p>Upgrade to Premium and:</p>
        <ul>
          <li>✓ Save unlimited YouTube videos</li>
          <li>✓ Never lose your progress again</li>
          <li>✓ Bulk delete & auto-delete features</li>
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
      <p>Your <strong>7-day free trial expires TODAY</strong>.</p>

      <div style="background: #ffebee; border-left: 4px solid #FF0000; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="margin-top: 0; color: #c62828;">Act Now!</h3>
        <p>After today, you'll switch to read-only mode and <strong>won't be able to add new videos</strong>.</p>
      </div>

      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h4 style="color: #FF0000; margin-top: 0;">Premium Plans:</h4>
        <p><strong>₹29/month</strong>, <strong>₹199/year</strong> (save 43%) or <strong>₹699 lifetime</strong></p>
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
    subject: 'Your trial has ended - but you can still view your videos',
    html: `
      <h2>Trial Period Ended</h2>
      <p>Hi ${name},</p>
      <p>Your <strong>7-day free trial</strong> has ended. Your account has been switched to <strong>Free (Read-Only) mode</strong>.</p>

      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h4>What You Can Still Do (Free Mode):</h4>
        <ul>
          <li>✓ View all your saved videos</li>
          <li>✓ Search and filter videos</li>
          <li>✓ Sort and organize</li>
          <li>✗ Cannot add new videos</li>
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
    const trialEndDate = getTrialEndDate();

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
          trial_start_date: new Date(),
          trial_end_date: trialEndDate,
          is_in_trial: true,
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
    // Get leftoff extension ID (creates the row if missing)
    const extensionId = await getExtensionId();

    const { data: user, error } = await supabase
      .from('extension_users')
      .select('*')
      .eq('email', req.params.email.toLowerCase())
      .eq('extension_id', extensionId)
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        fullName: user.full_name,
        email: user.email,
        leftOffId: user.left_off_id,
        tier: user.tier,
        isPremium: user.is_premium,
        isInTrial: user.is_in_trial,
        trialStartDate: user.trial_start_date,
        trialEndDate: user.trial_end_date,
        emailVerified: user.email_verified
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
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

    res.status(200).json({
      success: true,
      message: 'Trial reminders processed',
      usersProcessed: users.length
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
