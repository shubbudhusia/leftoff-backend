// Render's network cannot reach some hosts over IPv6 (ENETUNREACH) —
// prefer IPv4 for all DNS lookups (fixes Gmail SMTP connections)
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const DataSyncService = require('./services/data-sync-service');
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

// Initialize data sync service
const dataSyncService = new DataSyncService();

// Schedule automatic daily sync at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('\n====================================');
  console.log('🔄 AUTOMATIC DAILY SYNC STARTED');
  console.log('Time:', new Date().toLocaleString());
  console.log('====================================\n');

  try {
    await dataSyncService.syncAllData();
    console.log('\n✨ DAILY SYNC COMPLETED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('\n❌ SYNC FAILED:', error.message);
  }
});

// Manual sync endpoint
app.post('/api/admin/sync-now', async (req, res) => {
  try {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await dataSyncService.syncAllData();
    res.json({ success: true, message: 'Sync completed', timestamp: result.timestamp });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
      dodo: !!process.env.DODO_WEBHOOK_SECRET,
      dailySync: true,
      excel: true
    },
    nextSync: '02:00 AM (UTC)'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n✅ LeftOff Backend Server Started!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`📅 Scheduler: Daily sync at 2:00 AM`);
  console.log('\n🔌 Available Endpoints:');
  console.log('  POST /api/track/installation');
  console.log('  POST /api/track/video-activity');
  console.log('  GET  /api/user/dashboard/:email');
  console.log('  GET  /api/admin/analytics');
  console.log('  POST /api/admin/sync-now');
  console.log('  GET  /api/status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

module.exports = app;
