const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase Client] WARNING: SUPABASE_URL or SUPABASE_KEY is missing from environment.');
}

const supabase = createClient(
  supabaseUrl || 'https://oypqhmkklmuwbvfhctmo.supabase.co',
  supabaseKey || 'sb_publishable_--l3W1BxBEfLa0fvzutWfg_6ND5D15Q'
);

module.exports = supabase;
