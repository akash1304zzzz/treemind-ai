const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Default password is 'treemind123' if not set in .env
const APP_PASSWORD = process.env.APP_PASSWORD || 'treemind123';

app.use(cors());
app.use(express.json());

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
app.get('/api/queue', authMiddleware, (req, res) => {
  const queuePath = path.join(__dirname, '../queue.md');
  if (!fs.existsSync(queuePath)) {
    return res.json([]);
  }
  
  const content = fs.readFileSync(queuePath, 'utf8');
  const lines = content.split('\n');
  const queue = [];
  
  // Regex to match: - [ ] URL (Added: TIMESTAMP) (Depth: DEPTH)
  // or: - [x] URL (Processed: TIMESTAMP) (Depth: DEPTH)
  const pattern = /^\s*-\s*\[\s*([ xX])\s*\]\s*(https:\/\/[^\s()]+)(?:\s*\((Added|Processed):\s*([^)]+)\))?(?:\s*\(Depth:\s*([^)]+)\))?/;
  
  lines.forEach((line) => {
    const match = line.match(pattern);
    if (match) {
      const isProcessed = match[1].toLowerCase() === 'x';
      const url = match[2];
      const timeType = match[3]; // Added or Processed
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

app.post('/api/queue', authMiddleware, (req, res) => {
  const { url, depth } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const queuePath = path.join(__dirname, '../queue.md');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const depthVal = depth || 'Detailed Notes';
  
  const newLine = `- [ ] ${url} (Added: ${timestamp}) (Depth: ${depthVal})\n`;
  
  fs.appendFileSync(queuePath, newLine, 'utf8');
  res.json({ success: true, message: 'URL added to queue successfully.' });
});

// 3. Tree JSON Index Endpoint
app.get('/api/tree', authMiddleware, (req, res) => {
  const treePath = path.join(__dirname, '../vault/tree.json');
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
app.use('/api/vault', authMiddleware, express.static(path.join(__dirname, '../vault'), {
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
app.post('/api/ingest', authMiddleware, (req, res) => {
  console.log('Triggering queue ingestion process...');
  const ingestScript = path.join(__dirname, '../scripts/ingest.py');
  
  exec(`python "${ingestScript}"`, { env: process.env, cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Ingestion error: ${error.message}`);
      console.error(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
      return res.status(500).json({ 
        success: false, 
        error: error.message,
        stdout: stdout,
        stderr: stderr
      });
    }
    
    console.log('Ingestion finished successfully.');
    res.json({ 
      success: true, 
      stdout: stdout,
      stderr: stderr
    });
  });
});

// 7. Update Note Metadata (Category & Tags)
app.post('/api/note/update-metadata', authMiddleware, (req, res) => {
  const { id, categoryPath, tags } = req.body;
  
  if (!id || !categoryPath || !Array.isArray(categoryPath) || !tags || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'Missing or invalid parameters.' });
  }

  const treePath = path.join(__dirname, '../vault/tree.json');
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
    const newCategoryDir = path.join(__dirname, '../vault', ...categoryPath);
    fs.mkdirSync(newCategoryDir, { recursive: true });

    const filename = path.basename(oldRelativePath);
    const newRelativePath = path.join('vault', ...categoryPath, filename).replace(/\\/g, '/');
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
app.post('/api/category/rename', authMiddleware, (req, res) => {
  const { oldPath, newPath } = req.body;
  
  if (!oldPath || !Array.isArray(oldPath) || !newPath || !Array.isArray(newPath)) {
    return res.status(400).json({ error: 'Missing or invalid parameters.' });
  }

  const treePath = path.join(__dirname, '../vault/tree.json');
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
          const newDir = path.join(__dirname, '../vault', ...updatedCategoryPath);
          fs.mkdirSync(newDir, { recursive: true });
          
          const filename = path.basename(oldRelativePath);
          const newRelativePath = path.join('vault', ...updatedCategoryPath, filename).replace(/\\/g, '/');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TreeMind AI Local Server] running on http://0.0.0.0:${PORT}`);
});
