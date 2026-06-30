const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const DataSyncService = require('./services/data-sync-service');
const apiRoutes = require('./api-routes');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Routes
app.use(apiRoutes);

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
      stripe: !!process.env.STRIPE_SECRET_KEY,
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
