const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dns = require('dns');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase Client] WARNING: SUPABASE_URL or SUPABASE_KEY is missing from environment.');
}

const supabase = createClient(
  supabaseUrl || 'https://oypqhmkklmuwbvfhctmo.supabase.co',
  supabaseKey || 'sb_publishable_--l3W1BxBEfLa0fvzutWfg_6ND5D15Q',
  {
    global: {
      headers: { 'x-client-info': 'treemind-ai' },
    },
    db: {
      schema: 'public',
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

let isOnline = false;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000; // Check every 30 seconds

async function isAvailable() {
  if (!supabaseUrl || !supabaseKey) return false;
  
  const now = Date.now();
  if (now - lastCheckTime < CHECK_INTERVAL && lastCheckTime !== 0) {
    return isOnline;
  }
  lastCheckTime = now;

  try {
    const hostname = new URL(supabaseUrl).hostname;
    await new Promise((resolve, reject) => {
      dns.lookup(hostname, (err, address) => {
        if (err || !address) reject(err || new Error('No address'));
        else resolve(address);
      });
    });
    if (!isOnline) {
      console.log(`[Supabase Client] Successfully connected to Supabase (${hostname}).`);
    }
    isOnline = true;
  } catch (err) {
    if (isOnline || lastCheckTime === now) {
      console.warn(`[Supabase Client] Supabase is offline/unreachable (${err.message}). Operating in local vault storage.`);
    }
    isOnline = false;
  }
  return isOnline;
}

supabase.isAvailable = isAvailable;

module.exports = supabase;
