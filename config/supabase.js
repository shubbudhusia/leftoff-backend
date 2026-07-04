const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

// Supabase is REQUIRED — all user data lives there. Fail with a clear
// message instead of a cryptic crash if the env vars are missing.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ FATAL: Missing Supabase environment variables.');
  console.error('   Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)');
  console.error('   Set them in Render → your service → Environment.');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('extensions')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Supabase connection error:', error.message);
      return false;
    }

    console.log('✅ Supabase connected successfully');
    return true;
  } catch (err) {
    console.error('❌ Connection test failed:', err.message);
    return false;
  }
}

// Look up (or create) the 'leftoff' extension row and cache its id.
// Self-heals a fresh database instead of crashing with a null reference.
let cachedExtensionId = null;
async function getExtensionId() {
  if (cachedExtensionId) return cachedExtensionId;

  const { data: existing } = await supabase
    .from('extensions')
    .select('id')
    .eq('name', 'leftoff')
    .single();

  if (existing) {
    cachedExtensionId = existing.id;
    return cachedExtensionId;
  }

  const { data: created, error } = await supabase
    .from('extensions')
    .insert({ name: 'leftoff' })
    .select()
    .single();

  if (error || !created) {
    throw new Error(
      `Cannot read or create the 'leftoff' row in the extensions table: ${error?.message}. ` +
      'Check that SUPABASE_KEY is the service_role key (not the anon key).'
    );
  }

  console.log('[Supabase] Created missing leftoff extension row:', created.id);
  cachedExtensionId = created.id;
  return cachedExtensionId;
}

module.exports = {
  supabase,
  testConnection,
  getExtensionId
};
