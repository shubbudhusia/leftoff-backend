const cron = require('node-cron');
const DataSyncService = require('./services/data-sync-service');
require('dotenv').config();

const dataSyncService = new DataSyncService();

// Schedule daily data sync at 2 AM every day
cron.schedule('0 2 * * *', async () => {
  console.log('\n====================================');
  console.log('🔄 AUTOMATIC DAILY SYNC STARTED');
  console.log('====================================\n');

  try {
    await dataSyncService.syncAllData();
    console.log('\n✨ DAILY SYNC COMPLETED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('\n❌ SYNC FAILED:', error.message);
    console.log('Will retry tomorrow at 2 AM\n');
  }
});

// Optional: Run sync immediately on startup for testing
// Uncomment to test manually
/*
(async () => {
  console.log('Running initial sync...');
  await dataSyncService.syncAllData();
})();
*/

console.log('✅ Scheduler initialized!');
console.log('📅 Daily sync scheduled for 2:00 AM every day');
console.log('📊 Will sync: Razorpay, Stripe, user activity, trials, metrics, and Excel reports');
console.log('\nScheduler is running... Press Ctrl+C to stop\n');
