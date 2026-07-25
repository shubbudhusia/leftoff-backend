// Render's network cannot reach some hosts over IPv6 (ENETUNREACH) —
// prefer IPv4 for all DNS lookups (fixes Gmail SMTP connections)
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const apiRoutes = require('./api-routes');
const authRoutes = require('./routes/auth');
const razorpayWebhook = require('./routes/razorpay-webhook');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());

// Public website (landing page + terms/privacy/refund policy) —
// served at https://leftoff-backend.onrender.com/
app.use(express.static('public'));

// Payment webhooks need the RAW request body for signature verification,
// so they must be mounted BEFORE express.json()
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);
app.post('/api/dodo/webhook', express.raw({ type: 'application/json' }), require('./routes/dodo-webhook'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Routes
app.use(apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sync', require('./routes/sync'));
app.use('/api/trial', require('./routes/trial-device'));

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'LeftOff Backend Running',
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
    features: {
      supabase: !!process.env.SUPABASE_URL,
      razorpay: !!process.env.RAZORPAY_KEY_ID,
      dodo: !!process.env.DODO_WEBHOOK_SECRET
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n✅ LeftOff Backend Server Started!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log('\n🔌 Available Endpoints:');
  console.log('  POST /api/auth/signup | /verify | /resend-code');
  console.log('  GET  /api/auth/user/:email');
  console.log('  POST /api/trial/device');
  console.log('  POST /api/sync/save | /api/sync/load');
  console.log('  POST /api/razorpay/webhook | /api/dodo/webhook');
  console.log('  GET  /api/admin/analytics');
  console.log('  GET  /api/status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

module.exports = app;
