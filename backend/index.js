const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const supabase = require('./supabaseClient');
const { ingestQueue } = require('./ingest');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Default password is 'treemind123' if not set in .env
const APP_PASSWORD = process.env.APP_PASSWORD || 'treemind123';

app.use(cors());
app.use(express.json());

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
  
  const logs = [];
  const logCallback = (msg) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    const result = await ingestQueue(userId, getUserPaths, logCallback);
    
    if (result.success) {
      console.log('Ingestion finished successfully.');
      res.json({
        success: true,
        stdout: logs.join('\n'),
        stderr: ''
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        stdout: logs.join('\n'),
        stderr: result.error
      });
    }
  } catch (err) {
    console.error('Ingestion failed with exception:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stdout: logs.join('\n'),
      stderr: err.stack
    });
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

