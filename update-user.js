const { supabase } = require('./config/supabase');

async function updateUserToPremium() {
  try {
    console.log('🔄 Updating user to PREMIUM...');

    const { data, error } = await supabase
      .from('users')
      .update({ tier: 'PREMIUM' })
      .eq('email', 'dhusiashubham@gmail.com')
      .select();

    if (error) {
      console.log('❌ Error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('❌ User not found in database');
      process.exit(1);
    }

    console.log('✅ SUCCESS! User updated to PREMIUM:');
    console.log('Email:', data[0].email);
    console.log('Tier:', data[0].tier);
    console.log('Premium:', data[0].isPremium);
    process.exit(0);

  } catch (err) {
    console.log('❌ Error:', err.message);
    process.exit(1);
  }
}

updateUserToPremium();
