const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');

const vaultDir = path.join(__dirname, '../vault');

async function migrateUserVault(userId) {
  const userVaultPath = path.join(vaultDir, userId);
  const treePath = path.join(userVaultPath, 'tree.json');
  
  if (!fs.existsSync(treePath)) {
    console.log(`[Migration] No tree.json found for user ${userId}. Skipping.`);
    return;
  }
  
  console.log(`[Migration] Starting migration for user: ${userId}...`);
  let notesList = [];
  try {
    const content = fs.readFileSync(treePath, 'utf8');
    notesList = JSON.parse(content);
  } catch (e) {
    console.error(`[Migration] Failed to parse tree.json for ${userId}:`, e.message);
    return;
  }
  
  for (const note of notesList) {
    console.log(`[Migration] Processing note: "${note.title}" (${note.id})`);
    
    // Read markdown file
    const fullMarkdownPath = path.join(__dirname, '..', note.filePath);
    let markdownContent = '';
    if (fs.existsSync(fullMarkdownPath)) {
      markdownContent = fs.readFileSync(fullMarkdownPath, 'utf8');
    } else {
      console.warn(`[Migration] WARNING: Markdown file not found at ${fullMarkdownPath}`);
    }
    
    // Construct database record
    // Parse date processed safely
    let dateProcessedStr = note.dateProcessed || '';
    let parsedDate = new Date();
    if (dateProcessedStr) {
      // e.g. "2026-07-05 20:25" -> replace space with T
      const isoStr = dateProcessedStr.replace(' ', 'T');
      parsedDate = new Date(isoStr);
    }
    
    const record = {
      id: note.id,
      user_id: userId,
      title: note.title,
      url: note.url,
      tags: note.tags || [],
      category_path: note.categoryPath || [],
      snippet: note.snippet || '',
      date_processed: parsedDate.toISOString(),
      markdown_content: markdownContent,
      thumbnail_url: note.thumbnailUrl || '',
      file_path: note.filePath || ''
    };
    
    // Upsert note in Supabase notes table
    const { error } = await supabase
      .from('notes')
      .upsert(record);
      
    if (error) {
      console.error(`[Migration] ERROR migrating note ${note.id}:`, error.message);
    } else {
      console.log(`[Migration] Successfully migrated note ${note.id}`);
    }
  }
  
  console.log(`[Migration] Completed migration for user: ${userId}`);
}

async function start() {
  try {
    if (!fs.existsSync(vaultDir)) {
      console.log('[Migration] Vault directory does not exist. Nothing to migrate.');
      process.exit(0);
    }
    const users = fs.readdirSync(vaultDir).filter(f => fs.statSync(path.join(vaultDir, f)).isDirectory());
    for (const userId of users) {
      if (userId === 'thumbnails' || userId === 'alpha-thumbnails' || userId === 'beta-thumbnails') continue; // skip thumbnails directories
      await migrateUserVault(userId);
    }
    console.log('[Migration] All vaults successfully migrated!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Migration process failed:', err.message);
    process.exit(1);
  }
}

start();
