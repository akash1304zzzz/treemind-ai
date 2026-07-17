const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const supabase = require('./supabaseClient');
const { ingestQueue } = require('./ingest');
const { router: adminRouter, getEffectiveLimit } = require('./admin');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Default password is 'treemind123' if not set in .env
const APP_PASSWORD = process.env.APP_PASSWORD || 'treemind123';

app.use(cors());
app.use(express.json());

// Admin API routes (behind admin password)
app.use('/api/admin', adminRouter);

// Helper to get paths for a user
function getUserPaths(userId) {
  const safeUserId = userId ? userId.replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
  const vaultDir = path.join(__dirname, '../vault', safeUserId);
  const queuePath = path.join(vaultDir, 'queue.md');
  const treePath = path.join(vaultDir, 'tree.json');
  
  try {
    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true });
    }
    if (!fs.existsSync(treePath)) {
      fs.writeFileSync(treePath, '[]', 'utf8');
    }
    if (!fs.existsSync(queuePath)) {
      fs.writeFileSync(queuePath, '# Remind AI Ingestion Queue\n\n', 'utf8');
    }
  } catch (err) {
    console.warn(`[Local Filesystem Initialization Warning] Could not initialize local directory for ${safeUserId}:`, err.message);
  }
  
  return { vaultDir, queuePath, treePath, userId: safeUserId };
}

// Middleware to check app password
function authMiddleware(req, res, next) {
  const password = req.headers['x-app-password'] || req.query.password;
  if (password === APP_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Invalid app password.' });
  }
}

// 1. Auth Endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// 2. Queue Endpoints
app.get('/api/queue', authMiddleware, async (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data, error } = await supabase
        .from('queue')
        .select('*')
        .eq('user_id', userId)
        .order('date_added', { ascending: false });

      if (error) throw error;
      
      const queue = data.map(item => {
        const addedStr = item.date_added ? (item.date_added instanceof Date ? item.date_added.toISOString() : String(item.date_added)).replace('T', ' ').substring(0, 16) : '';
        return {
          url: item.url,
          processed: item.status === 'completed',
          addedTime: addedStr,
          processedTime: item.status === 'completed' ? addedStr : '',
          depth: item.depth
        };
      });
      return res.json(queue);
    } catch (err) {
      console.error('[Supabase Queue Get Error]:', err.message);
    }
  }

  const { queuePath } = getUserPaths(userId);
  if (!fs.existsSync(queuePath)) {
    return res.json([]);
  }
  
  const content = fs.readFileSync(queuePath, 'utf8');
  const lines = content.split('\n');
  const queue = [];
  const pattern = /^\s*-\s*\[\s*([ xX])\s*\]\s*(https:\/\/[^\s()]+)(?:\s*\((Added|Processed):\s*([^)]+)\))?(?:\s*\(Depth:\s*([^)]+)\))?/;
  
  lines.forEach((line) => {
    const match = line.match(pattern);
    if (match) {
      const isProcessed = match[1].toLowerCase() === 'x';
      const url = match[2];
      const timeType = match[3];
      const timeVal = match[4] || '';
      const depth = match[5] || 'Detailed Notes';
      
      queue.push({
        url,
        processed: isProcessed,
        addedTime: timeType === 'Added' ? timeVal : '',
        processedTime: timeType === 'Processed' ? timeVal : '',
        depth
      });
    }
  });
  
  res.json(queue);
});

app.post('/api/queue', authMiddleware, async (req, res) => {
  const { url, depth } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const userId = req.headers['x-user-id'] || 'default';

  // Check if user is disabled (admin can disable users)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('is_disabled')
        .eq('user_id', userId)
        .maybeSingle();
      if (userRow && userRow.is_disabled) {
        return res.status(403).json({ error: 'This account has been disabled. Contact the administrator.' });
      }
    } catch (_) { /* non-blocking */ }
  }

  // Enforcement check: dynamic monthly limit (per-user or global)
  const monthlyLimit = await getEffectiveLimit(userId);
  let currentMonthCount = 0;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const { count, error } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date_processed', startOfMonth.toISOString());
      
      if (!error && count !== null) {
        currentMonthCount = count;
      }
    } catch (err) {
      console.error('[Limit Check Error]: Failed to count Supabase notes:', err.message);
    }
  } else {
    // Local JSON fallback
    try {
      const { getUserPaths } = require('./index'); // self reference or access local paths
      const paths = getUserPaths(userId);
      if (fs.existsSync(paths.treePath)) {
        const data = JSON.parse(fs.readFileSync(paths.treePath, 'utf8'));
        if (Array.isArray(data)) {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth() + 1;
          
          currentMonthCount = data.filter(note => {
            if (!note.dateProcessed) return false;
            const datePart = note.dateProcessed.split(' ')[0];
            const parts = datePart.split('-');
            if (parts.length < 2) return false;
            return parseInt(parts[0], 10) === currentYear && parseInt(parts[1], 10) === currentMonth;
          }).length;
        }
      }
    } catch (err) {
      console.warn('[Limit Check Error]: Failed to count local JSON notes:', err.message);
    }
  }

  if (currentMonthCount >= monthlyLimit) {
    return res.status(403).json({ error: `Monthly limit of ${monthlyLimit} video summaries reached. Please upgrade to Premium or contact your administrator.` });
  }

  const { queuePath } = getUserPaths(userId);
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const depthVal = depth || 'Detailed Notes';

  // Try to write to local queue.md — Python ingest script reads from here
  let localWriteSuccess = false;
  try {
    const newLine = `- [ ] ${url} (Added: ${timestamp}) (Depth: ${depthVal})\n`;
    fs.appendFileSync(queuePath, newLine, 'utf8');
    localWriteSuccess = true;
  } catch (err) {
    console.warn('[Local Queue Write Warning]: Could not write queue.md locally:', err.message);
  }

  // Also write to Supabase if available (for cloud/Vercel deployments)
  let supabaseWriteSuccess = false;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { error } = await supabase
        .from('queue')
        .insert({
          user_id: userId,
          url,
          depth: depthVal,
          status: 'pending'
        });
      if (error) throw error;
      supabaseWriteSuccess = true;
    } catch (err) {
      console.error('[Supabase Queue Insert Error]:', err.message);
    }
  }

  if (!localWriteSuccess && !supabaseWriteSuccess) {
    return res.status(500).json({ error: 'Failed to write URL to queue in both local file and Supabase.' });
  }

  res.json({ success: true, message: 'URL added to queue successfully.' });
});

// 3. Tree JSON Index Endpoint
app.get('/api/tree', authMiddleware, async (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;
      
      const formatted = data.map(note => ({
        id: note.id,
        title: note.title,
        url: note.url,
        tags: note.tags || [],
        categoryPath: note.category_path || [],
        snippet: note.snippet || '',
        dateProcessed: note.date_processed ? (note.date_processed instanceof Date ? note.date_processed.toISOString() : String(note.date_processed)).replace('T', ' ').substring(0, 16) : '',
        filePath: note.file_path || '',
        thumbnailUrl: note.thumbnail_url || ''
      }));
      
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.json(formatted);
    } catch (err) {
      console.error('[Supabase Tree Get Error]:', err.message);
    }
  }

  const { treePath } = getUserPaths(userId);
  if (!fs.existsSync(treePath)) {
    return res.json([]);
  }
  try {
    const content = fs.readFileSync(treePath, 'utf8');
    const data = JSON.parse(content);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse vault tree index: ' + error.message });
  }
});

// 4. Vault Files Static Access
app.use('/api/vault', authMiddleware, async (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId || 'default';
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const requestedPath = path.normalize(req.path).replace(/\\/g, '/');
  
  if (!requestedPath.startsWith(`/${safeUserId}/`)) {
    return res.status(403).json({ error: 'Access denied to this vault.' });
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      // 1. Handle thumbnails redirection to Supabase public bucket
      if (requestedPath.includes('/thumbnails/')) {
        const filename = path.basename(requestedPath);
        const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${filename}`;
        return res.redirect(publicUrl);
      }

      // 2. Handle note Markdown content read from database
      if (requestedPath.endsWith('.md')) {
        const relativeFilePath = `vault${requestedPath}`; // e.g. "vault/alpha/Travel/Dubai/note.md"
        const { data, error } = await supabase
          .from('notes')
          .select('markdown_content')
          .eq('user_id', safeUserId)
          .eq('file_path', relativeFilePath)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          return res.send(data.markdown_content);
        }
      }
    } catch (err) {
      console.error('[Supabase Vault Static Error]:', err.message);
    }
  }

  next();
}, express.static(path.join(__dirname, '../vault'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// 5. API settings update (write keys to .env)
app.post('/api/settings', authMiddleware, (req, res) => {
  const { geminiApiKey, nvidiaApiKey, apifyToken, appPassword } = req.body;
  const envPath = path.join(__dirname, '../.env');
  
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  const envVars = {};
  // Parse existing environment variables
  envContent.split('\n').forEach((line) => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key && !key.startsWith('#')) {
        envVars[key] = val;
      }
    }
  });
  
  // Update values
  if (geminiApiKey !== undefined) envVars['GEMINI_API_KEY'] = geminiApiKey;
  if (nvidiaApiKey !== undefined) envVars['NVIDIA_API_KEY'] = nvidiaApiKey;
  if (apifyToken !== undefined) envVars['APIFY_TOKEN'] = apifyToken;
  if (appPassword !== undefined) envVars['APP_PASSWORD'] = appPassword;
  
  // Format content
  let newContent = '';
  Object.keys(envVars).forEach((key) => {
    newContent += `${key}=${envVars[key]}\n`;
  });
  
  fs.writeFileSync(envPath, newContent, 'utf8');
  
  // Reload environment variables in current process memory
  if (geminiApiKey !== undefined) process.env.GEMINI_API_KEY = geminiApiKey;
  if (nvidiaApiKey !== undefined) process.env.NVIDIA_API_KEY = nvidiaApiKey;
  if (apifyToken !== undefined) process.env.APIFY_TOKEN = apifyToken;
  if (appPassword !== undefined) process.env.APP_PASSWORD = appPassword;
  
  res.json({ success: true, message: 'Settings saved successfully.' });
});

// 6. Ingest Trigger Endpoint
app.post('/api/ingest', authMiddleware, async (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  console.log(`Triggering queue ingestion process for user: ${userId}...`);
  
  // Set headers for response streaming to keep connection alive and bypass Vercel timeouts
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const logCallback = (msg) => {
    console.log(msg);
    try {
      res.write(msg + '\n');
    } catch (e) {
      console.error('Failed to write stream chunk:', e.message);
    }
  };

  // Set up keep-alive heartbeat interval to keep connection open during slow operations (LLM, Scrapers)
  const heartbeat = setInterval(() => {
    try {
      res.write(' \n'); // Send a space and newline as a heartbeat chunk
    } catch (e) {
      console.error('Failed to write heartbeat chunk:', e.message);
    }
  }, 4000);

  try {
    const result = await ingestQueue(userId, getUserPaths, logCallback);
    
    if (result.success) {
      console.log('Ingestion finished successfully.');
      const metadata = {
        success: true,
        remainingCount: result.remainingCount || 0
      };
      res.write('__METADATA__:' + JSON.stringify(metadata) + '\n');
    } else {
      const metadata = {
        success: false,
        error: result.error
      };
      res.write('__METADATA__:' + JSON.stringify(metadata) + '\n');
    }
  } catch (err) {
    console.error('Ingestion failed with exception:', err);
    res.write(`[Error] Ingestion failed: ${err.message}\n`);
    const metadata = {
      success: false,
      error: err.message
    };
    res.write('__METADATA__:' + JSON.stringify(metadata) + '\n');
  } finally {
    clearInterval(heartbeat);
    try {
      res.end();
    } catch (e) {}
  }
});

// 7. Update Note Metadata (Category & Tags)
app.post('/api/note/update-metadata', authMiddleware, async (req, res) => {
  const { id, categoryPath, tags } = req.body;
  
  if (!id || !categoryPath || !Array.isArray(categoryPath) || !tags || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'Missing or invalid parameters.' });
  }

  const userId = req.headers['x-user-id'] || 'default';

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data: note, error: fetchErr } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!note) return res.status(404).json({ error: 'Note not found.' });

      const filename = path.basename(note.file_path);
      const newRelativePath = `vault/${userId}/${categoryPath.join('/')}/${filename}`.replace(/\\/g, '/');

      let updatedMarkdown = note.markdown_content || '';
      const match = updatedMarkdown.match(/^---([\s\S]*?)---\n*([\s\S]*)$/);
      if (match) {
        const frontmatterText = match[1];
        const markdownBody = match[2];
        const lines = frontmatterText.split('\n');
        const updatedLines = lines.map(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('tags:')) return `tags: ${JSON.stringify(tags)}`;
          if (trimmed.startsWith('category:')) return `category: "${categoryPath.join(' / ')}"`;
          return line;
        });
        updatedMarkdown = `---\n${updatedLines.join('\n')}\n---\n\n${markdownBody.trim()}\n`;
      }

      const { error: updateErr } = await supabase
        .from('notes')
        .update({
          category_path: categoryPath,
          tags: tags,
          file_path: newRelativePath,
          markdown_content: updatedMarkdown
        })
        .eq('id', id)
        .eq('user_id', userId);

      if (updateErr) throw updateErr;

      return res.json({ success: true, note: {
        id: note.id,
        title: note.title,
        url: note.url,
        tags: tags,
        categoryPath: categoryPath,
        snippet: note.snippet,
        dateProcessed: note.date_processed,
        filePath: newRelativePath,
        thumbnailUrl: note.thumbnail_url
      }});
    } catch (err) {
      console.error('[Supabase Metadata Update Error]:', err.message);
    }
  }

  const { vaultDir, treePath } = getUserPaths(userId);
  if (!fs.existsSync(treePath)) {
    return res.status(404).json({ error: 'Vault tree index file not found.' });
  }

  try {
    const content = fs.readFileSync(treePath, 'utf8');
    const treeData = JSON.parse(content);
    
    const noteIndex = treeData.findIndex(item => item.id === id);
    if (noteIndex === -1) {
      return res.status(404).json({ error: 'Note not found in index.' });
    }

    const note = treeData[noteIndex];
    const oldRelativePath = note.filePath;
    const fullOldPath = path.join(__dirname, '..', oldRelativePath);

    if (!fs.existsSync(fullOldPath)) {
      return res.status(404).json({ error: 'Note Markdown file not found on disk.' });
    }

    // Read and parse markdown content
    let fileContent = fs.readFileSync(fullOldPath, 'utf8');
    const match = fileContent.match(/^---([\s\S]*?)---\n*([\s\S]*)$/);
    let newFileContent = fileContent;

    if (match) {
      const frontmatterText = match[1];
      const markdownBody = match[2];
      const lines = frontmatterText.split('\n');
      
      const updatedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('tags:')) {
          return `tags: ${JSON.stringify(tags)}`;
        }
        if (trimmed.startsWith('category:')) {
          return `category: "${categoryPath.join(' / ')}"`;
        }
        return line;
      });
      newFileContent = `---\n${updatedLines.join('\n')}\n---\n\n${markdownBody.trim()}\n`;
    }

    // Create new folder structure if directory path changed
    const newCategoryDir = path.join(vaultDir, ...categoryPath);
    fs.mkdirSync(newCategoryDir, { recursive: true });

    const filename = path.basename(oldRelativePath);
    const newRelativePath = path.join('vault', userId, ...categoryPath, filename).replace(/\\/g, '/');
    const fullNewPath = path.join(__dirname, '..', newRelativePath);

    // Save content to the new path
    fs.writeFileSync(fullNewPath, newFileContent, 'utf8');

    // Delete old file if path has changed
    if (fullOldPath !== fullNewPath) {
      try {
        fs.unlinkSync(fullOldPath);
      } catch (err) {
        console.error(`Failed to delete old file: ${err.message}`);
      }
    }

    // Update note record metadata
    note.tags = tags;
    note.categoryPath = categoryPath;
    note.filePath = newRelativePath;
    
    // Write tree.json back to disk
    fs.writeFileSync(treePath, JSON.stringify(treeData, null, 2), 'utf8');

    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note metadata: ' + error.message });
  }
});

// 8. Rename Category (Mass Relocation)
app.post('/api/category/rename', authMiddleware, async (req, res) => {
  const { oldPath, newPath } = req.body;
  
  if (!oldPath || !Array.isArray(oldPath) || !newPath || !Array.isArray(newPath)) {
    return res.status(400).json({ error: 'Missing or invalid parameters.' });
  }

  const userId = req.headers['x-user-id'] || 'default';

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data: notes, error: fetchErr } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId);

      if (fetchErr) throw fetchErr;

      let renamedCount = 0;
      for (const note of notes) {
        const matches = oldPath.every((val, index) => note.category_path && note.category_path[index] === val);
        if (matches) {
          const suffix = note.category_path.slice(oldPath.length);
          const updatedCategoryPath = [...newPath, ...suffix];
          const filename = path.basename(note.file_path);
          const newRelativePath = `vault/${userId}/${updatedCategoryPath.join('/')}/${filename}`.replace(/\\/g, '/');

          let updatedMarkdown = note.markdown_content || '';
          const matchFM = updatedMarkdown.match(/^---([\s\S]*?)---\n*([\s\S]*)$/);
          if (matchFM) {
            const frontmatterText = matchFM[1];
            const markdownBody = matchFM[2];
            const lines = frontmatterText.split('\n');
            const updatedLines = lines.map(line => {
              const trimmed = line.trim();
              if (trimmed.startsWith('category:')) return `category: "${updatedCategoryPath.join(' / ')}"`;
              return line;
            });
            updatedMarkdown = `---\n${updatedLines.join('\n')}\n---\n\n${markdownBody.trim()}\n`;
          }

          const { error: updateErr } = await supabase
            .from('notes')
            .update({
              category_path: updatedCategoryPath,
              file_path: newRelativePath,
              markdown_content: updatedMarkdown
            })
            .eq('id', note.id);

          if (updateErr) throw updateErr;
          renamedCount++;
        }
      }

      return res.json({ success: true, renamedCount });
    } catch (err) {
      console.error('[Supabase Category Rename Error]:', err.message);
    }
  }

  const { vaultDir, treePath } = getUserPaths(userId);
  if (!fs.existsSync(treePath)) {
    return res.status(404).json({ error: 'Vault tree index file not found.' });
  }

  try {
    const content = fs.readFileSync(treePath, 'utf8');
    const treeData = JSON.parse(content);
    
    let renamedCount = 0;

    treeData.forEach(note => {
      // Check if note's categoryPath starts with oldPath
      const matches = oldPath.every((val, index) => note.categoryPath && note.categoryPath[index] === val);
      if (matches) {
        const suffix = note.categoryPath.slice(oldPath.length);
        const updatedCategoryPath = [...newPath, ...suffix];
        
        const oldRelativePath = note.filePath;
        const fullOldPath = path.join(__dirname, '..', oldRelativePath);
        
        if (fs.existsSync(fullOldPath)) {
          // Read markdown content and replace frontmatter category variable
          let fileContent = fs.readFileSync(fullOldPath, 'utf8');
          const matchFM = fileContent.match(/^---([\s\S]*?)---\n*([\s\S]*)$/);
          let newFileContent = fileContent;
          
          if (matchFM) {
            const frontmatterText = matchFM[1];
            const markdownBody = matchFM[2];
            const lines = frontmatterText.split('\n');
            const updatedLines = lines.map(line => {
              const trimmed = line.trim();
              if (trimmed.startsWith('category:')) {
                return `category: "${updatedCategoryPath.join(' / ')}"`;
              }
              return line;
            });
            newFileContent = `---\n${updatedLines.join('\n')}\n---\n\n${markdownBody.trim()}\n`;
          }
          
          // Write to the new folder path
          const newDir = path.join(vaultDir, ...updatedCategoryPath);
          fs.mkdirSync(newDir, { recursive: true });
          
          const filename = path.basename(oldRelativePath);
          const newRelativePath = path.join('vault', userId, ...updatedCategoryPath, filename).replace(/\\/g, '/');
          const fullNewPath = path.join(__dirname, '..', newRelativePath);
          
          fs.writeFileSync(fullNewPath, newFileContent, 'utf8');
          
          // Delete old file if path has changed
          if (fullOldPath !== fullNewPath) {
            try {
              fs.unlinkSync(fullOldPath);
            } catch (err) {
              console.error(`Failed to delete old file: ${err.message}`);
            }
          }
          
          // Update note metadata
          note.categoryPath = updatedCategoryPath;
          note.filePath = newRelativePath;
          renamedCount++;
        }
      }
    });

    // Write tree.json back to disk
    fs.writeFileSync(treePath, JSON.stringify(treeData, null, 2), 'utf8');
    res.json({ success: true, renamedCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename category: ' + error.message });
  }
});

// 9. Delete Note Route
app.post('/api/note/delete', authMiddleware, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Note ID is required.' });
  }

  const userId = req.headers['x-user-id'] || 'default';

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { error: dbErr } = await supabase
        .from('notes')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (dbErr) throw dbErr;

      const filename = `${id}.jpg`;
      await supabase.storage
        .from('thumbnails')
        .remove([filename]);

      return res.json({ success: true, message: 'Note deleted successfully.' });
    } catch (err) {
      console.error('[Supabase Note Delete Error]:', err.message);
    }
  }

  const { vaultDir, treePath } = getUserPaths(userId);
  if (!fs.existsSync(treePath)) {
    return res.status(404).json({ error: 'Vault tree index file not found.' });
  }

  try {
    const content = fs.readFileSync(treePath, 'utf8');
    const treeData = JSON.parse(content);
    
    const noteIndex = treeData.findIndex(n => n.id === id);
    if (noteIndex === -1) {
      return res.status(404).json({ error: 'Note not found in database.' });
    }

    const note = treeData[noteIndex];
    const fullFilePath = path.join(__dirname, '..', note.filePath);

    // 1. Delete physical markdown file
    if (fs.existsSync(fullFilePath)) {
      try {
        fs.unlinkSync(fullFilePath);
      } catch (err) {
        console.error(`Failed to delete markdown file: ${err.message}`);
      }
    }

    // 2. Delete cached thumbnail if it is local
    if (note.thumbnailUrl && note.thumbnailUrl.startsWith('/api/')) {
      const cleanThumbnailPath = note.thumbnailUrl.replace('/api/', '');
      const fullThumbnailPath = path.join(__dirname, '..', cleanThumbnailPath);
      if (fs.existsSync(fullThumbnailPath)) {
        try {
          fs.unlinkSync(fullThumbnailPath);
        } catch (err) {
          console.error(`Failed to delete thumbnail file: ${err.message}`);
        }
      }
    }

    // 3. Remove entry from tree.json
    treeData.splice(noteIndex, 1);
    fs.writeFileSync(treePath, JSON.stringify(treeData, null, 2), 'utf8');

    res.json({ success: true, message: 'Note deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note: ' + error.message });
  }
});

// --- Chatbot Feature Helpers ---

// Helper to extract chat history from markdown content
function extractChatHistory(markdown) {
  if (!markdown) return [];
  const match = markdown.match(/<!-- CHAT_HISTORY_JSON:([\s\S]*?)-->/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      console.error('Failed to parse CHAT_HISTORY_JSON from markdown:', e.message);
    }
  }
  return [];
}

// Helper to remove chat history block from markdown content
function getCleanNoteBody(markdown) {
  if (!markdown) return '';
  return markdown.replace(/<!-- CHAT_HISTORY_JSON:[\s\S]*?-->/g, '').trim();
}

// Helper to insert or replace chat history in markdown content
function updateChatHistoryInMarkdown(markdown, messages) {
  const cleanBody = getCleanNoteBody(markdown);
  const jsonStr = JSON.stringify(messages);
  return `${cleanBody}\n\n<!-- CHAT_HISTORY_JSON:${jsonStr} -->\n`;
}

// --- Chatbot Feature Endpoints ---

// 9. Get Chat History for a Note
app.get('/api/note/:id/chat', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.headers['x-user-id'] || 'default';
  
  let markdown = '';
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('markdown_content')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        markdown = data.markdown_content || '';
      }
    } catch (err) {
      console.error('[Supabase Note Chat Get Error]:', err.message);
      return res.status(500).json({ error: 'Failed to fetch note from database.' });
    }
  } else {
    const { treePath } = getUserPaths(userId);
    if (!fs.existsSync(treePath)) {
      return res.status(404).json({ error: 'Vault tree index file not found.' });
    }
    try {
      const content = fs.readFileSync(treePath, 'utf8');
      const treeData = JSON.parse(content);
      const note = treeData.find(n => n.id === id);
      if (!note) {
        return res.status(404).json({ error: 'Note not found in index.' });
      }
      const fullFilePath = path.join(__dirname, '..', note.filePath);
      if (fs.existsSync(fullFilePath)) {
        markdown = fs.readFileSync(fullFilePath, 'utf8');
      } else {
        return res.status(404).json({ error: 'Note file not found on disk.' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read note chat history: ' + err.message });
    }
  }

  const messages = extractChatHistory(markdown);
  res.json({ success: true, messages });
});

// 10. Post new message to Note Chat
app.post('/api/note/:id/chat', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const userId = req.headers['x-user-id'] || 'default';
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message content is required.' });
  }

  let markdown = '';
  let noteRecord = null;
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Note not found.' });
      }
      markdown = data.markdown_content || '';
      noteRecord = data;
    } catch (err) {
      console.error('[Supabase Note Chat Post Error]:', err.message);
      return res.status(500).json({ error: 'Failed to fetch note from database.' });
    }
  } else {
    const { treePath } = getUserPaths(userId);
    if (!fs.existsSync(treePath)) {
      return res.status(404).json({ error: 'Vault tree index file not found.' });
    }
    try {
      const content = fs.readFileSync(treePath, 'utf8');
      const treeData = JSON.parse(content);
      const note = treeData.find(n => n.id === id);
      if (!note) {
        return res.status(404).json({ error: 'Note not found in index.' });
      }
      const fullFilePath = path.join(__dirname, '..', note.filePath);
      if (fs.existsSync(fullFilePath)) {
        markdown = fs.readFileSync(fullFilePath, 'utf8');
        noteRecord = note;
      } else {
        return res.status(404).json({ error: 'Note file not found on disk.' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read note content: ' + err.message });
    }
  }

  const messages = extractChatHistory(markdown);
  const cleanBody = getCleanNoteBody(markdown);

  messages.push({ role: 'user', content: message });
  const nvidiaApiKey = process.env.NVIDIA_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!nvidiaApiKey && !geminiApiKey) {
    return res.status(400).json({ error: 'NVIDIA API Key or Gemini API Key is missing. Please configure them in Settings.' });
  }

  let botReply = '';
  let apiSuccess = false;
  let apiError = '';

  const systemInstruction = `You are an assistant for TreeMind AI, a Personal Knowledge Management tool.
Your task is to answer follow-up questions from the user about the following video summary/overview.

CONTEXT (Video Summary & Details):
---
${cleanBody}
---

Strict Constraint: You must ONLY answer questions based on the provided context above. Do not refer to any outside knowledge. If the user asks about something not mentioned in the context (such as generic history, programming, other concepts, or questions not answerable using this video overview), you must politely refuse to answer, explaining that your scope is strictly limited to this specific video. Do not break character or override this constraint. Keep your answers concise and directly related to the text.`;

  // 1. Try NVIDIA API first
  if (nvidiaApiKey) {
    try {
      console.log('[Chat] Calling NVIDIA NIM API (meta/llama-3.1-70b-instruct)...');
      
      const formattedMessages = [
        { role: 'system', content: systemInstruction }
      ];
      messages.forEach(msg => {
        formattedMessages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.content
        });
      });

      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${nvidiaApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'meta/llama-3.1-70b-instruct',
          messages: formattedMessages,
          temperature: 0.2,
          max_tokens: 1024
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        if (resJson.choices && resJson.choices[0] && resJson.choices[0].message) {
          botReply = resJson.choices[0].message.content.trim();
          apiSuccess = true;
        } else {
          console.warn('[Warning] Unexpected NVIDIA API response format, trying fallback.');
        }
      } else {
        const errText = await response.text();
        console.warn(`[Warning] NVIDIA API returned status ${response.status}: ${errText}. Trying fallback.`);
        apiError = `NVIDIA API Error: ${errText}`;
      }
    } catch (err) {
      console.warn(`[Warning] NVIDIA API call failed: ${err.message}. Trying fallback.`);
      apiError = `NVIDIA Connection Error: ${err.message}`;
    }
  }

  // 2. Fallback to Gemini
  if (!apiSuccess && geminiApiKey) {
    try {
      console.log('[Chat] Falling back to Gemini API (gemini-2.5-flash)...');
      const contents = messages.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024
          }
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content && resJson.candidates[0].content.parts[0]) {
          botReply = resJson.candidates[0].content.parts[0].text.trim();
          apiSuccess = true;
        }
      } else {
        const errText = await response.text();
        apiError = `Gemini API Error: ${errText}`;
      }
    } catch (err) {
      apiError = `Gemini Connection Error: ${err.message}`;
    }
  }

  if (!apiSuccess) {
    return res.status(500).json({ error: `AI Generation failed. ${apiError}` });
  }

  messages.push({ role: 'model', content: botReply });

  const updatedMarkdown = updateChatHistoryInMarkdown(markdown, messages);

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { error } = await supabase
        .from('notes')
        .update({ markdown_content: updatedMarkdown })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error('[Supabase Note Chat Update Error]:', err.message);
      return res.status(500).json({ error: 'Failed to save updated chat to database.' });
    }
  }

  if (noteRecord && (noteRecord.file_path || noteRecord.filePath)) {
    const relPath = noteRecord.file_path || noteRecord.filePath;
    const fullFilePath = path.join(__dirname, '..', relPath);
    try {
      fs.mkdirSync(path.dirname(fullFilePath), { recursive: true });
      fs.writeFileSync(fullFilePath, updatedMarkdown, 'utf8');
    } catch (err) {
      console.warn(`[Local Note Chat Write Warning]: Could not write note file locally:`, err.message);
    }
  }

  res.json({ success: true, messages });
});

// 11. Reset Chat History for a Note
app.post('/api/note/:id/chat/reset', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.headers['x-user-id'] || 'default';

  let markdown = '';
  let noteRecord = null;
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Note not found.' });
      }
      markdown = data.markdown_content || '';
      noteRecord = data;
    } catch (err) {
      console.error('[Supabase Note Chat Reset Error]:', err.message);
      return res.status(500).json({ error: 'Failed to fetch note from database.' });
    }
  } else {
    const { treePath } = getUserPaths(userId);
    if (!fs.existsSync(treePath)) {
      return res.status(404).json({ error: 'Vault tree index file not found.' });
    }
    try {
      const content = fs.readFileSync(treePath, 'utf8');
      const treeData = JSON.parse(content);
      const note = treeData.find(n => n.id === id);
      if (!note) {
        return res.status(404).json({ error: 'Note not found in index.' });
      }
      const fullFilePath = path.join(__dirname, '..', note.filePath);
      if (fs.existsSync(fullFilePath)) {
        markdown = fs.readFileSync(fullFilePath, 'utf8');
        noteRecord = note;
      } else {
        return res.status(404).json({ error: 'Note file not found on disk.' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read note: ' + err.message });
    }
  }

  const updatedMarkdown = getCleanNoteBody(markdown);

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const { error } = await supabase
        .from('notes')
        .update({ markdown_content: updatedMarkdown })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error('[Supabase Note Chat Reset Update Error]:', err.message);
      return res.status(500).json({ error: 'Failed to save note to database.' });
    }
  }

  if (noteRecord && (noteRecord.file_path || noteRecord.filePath)) {
    const relPath = noteRecord.file_path || noteRecord.filePath;
    const fullFilePath = path.join(__dirname, '..', relPath);
    try {
      fs.writeFileSync(fullFilePath, updatedMarkdown, 'utf8');
    } catch (err) {
      console.warn(`[Local Note Chat Reset Write Warning]: Could not write note file locally:`, err.message);
    }
  }

  res.json({ success: true, messages: [] });
});

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Serve frontend assets in production with disabled cache headers
app.use(express.static(path.join(__dirname, '../frontend/dist'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.get('*', (req, res) => {
  const indexHtml = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(indexHtml)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexHtml);
  } else {
    res.send('Backend Server is Running. Frontend not built yet.');
  }
});

// Export for Vercel serverless deployment
module.exports = app;

// Start local server when not in a serverless environment
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TreeMind AI Local Server] running on http://0.0.0.0:${PORT}`);
  });
}

