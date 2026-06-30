const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/signup
router.post('/signup', authController.signup);

// POST /api/auth/verify
router.post('/verify', authController.verifyCode);

// GET /api/auth/user/:email
router.get('/user/:email', authController.getUser);

// POST /api/auth/resend-code
router.post('/resend-code', authController.resendVerificationCode);

// POST /api/auth/process-reminders (call daily via cron)
router.post('/process-reminders', authController.processTrialReminders);

// POST /api/auth/upgrade-to-premium
router.post('/upgrade-to-premium', authController.upgradeToPremium);

module.exports = router;
