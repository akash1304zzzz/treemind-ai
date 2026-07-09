const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');

// Helper to sanitize filename
function sanitizeFilename(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9\s\-]/g, '_').replace(/\s+/g, '_');
  return sanitized.replace(/^_+|_+$/g, '').toLowerCase();
}

// Decode HTML entities
function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Robust JSON parser to handle raw newlines inside string literals from LLM outputs
function parseRobustJson(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      // Escape raw newlines inside double quotes
      let sanitized = str.replace(/"([^"\\]|\\.)*"/g, (match) => {
        return match.replace(/\r?\n/g, '\\n');
      });
      return JSON.parse(sanitized);
    } catch (e2) {
      throw new Error(`JSON parse failed: ${e.message} (Sanitization retry failed: ${e2.message})`);
    }
  }
}

// Robust fetch with retry helper
async function fetchWithRetry(url, options = {}, retries = 3, delay = 2000, logger) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      logger(`[Warning] Fetch failed (${e.message}). Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Fallback metadata scraper for YouTube
async function getYouTubeMetadataFallback(url, logger) {
  try {
    logger(`[Ingest] Running native fallback scraper for YouTube: ${url}`);
    const res = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    }, 3, 2000, logger);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/) || html.match(/<meta name="description" content="([^"]+)"/);
    const thumbMatch = html.match(/<meta property="og:image" content="([^"]+)"/) || html.match(/<link rel="image_src" href="([^"]+)"/);
    
    // Extract video ID for fallback thumbnail
    const videoIdMatch = url.match(/(?:v=|\/shorts\/|\/embed\/|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : '';
    
    let parsedTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : 'YouTube Video';
    if (!parsedTitle || parsedTitle.toLowerCase() === 'youtube' || parsedTitle === ' - YouTube' || parsedTitle.toLowerCase() === 'youtube video') {
      parsedTitle = `YouTube Video ${videoId ? `(${videoId})` : ''}`;
    }

    const meta = {
      title: parsedTitle,
      description: descMatch ? decodeHtmlEntities(descMatch[1]) : '',
      displayUrl: thumbMatch ? thumbMatch[1] : (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : ''),
      ownerUsername: 'YouTube Creator'
    };
    logger(`[Ingest] Successfully scraped fallback YouTube metadata: "${meta.title}"`);
    return meta;
  } catch (e) {
    logger(`[Warning] YouTube fallback scraping failed: ${e.message}`);
    return null;
  }
}

// Sync run Apify Actor helper
async function runApifyActorSync(actorName, input, apifyToken, logger) {
  try {
    const cleanActorName = actorName.replace(/\//g, '~');
    logger(`[Apify] Triggering actor ${actorName} synchronously...`);
    const res = await fetchWithRetry(`https://api.apify.com/v2/acts/${cleanActorName}/run-sync-get-dataset-items?token=${apifyToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    }, 3, 2000, logger);
    
    if (!res.ok) {
      throw new Error(`Apify API returned HTTP ${res.status}: ${res.statusText}`);
    }
    
    const items = await res.json();
    logger(`[Apify] Actor finished successfully. Retrieved ${items.length} items.`);
    return items;
  } catch (e) {
    logger(`[Error] Apify actor run failed: ${e.message}`);
    return null;
  }
}

// Download image helper
async function downloadImageToBuffer(url, logger) {
  try {
    logger(`[Ingest] Downloading thumbnail from: ${url}`);
    const res = await fetchWithRetry(url, {}, 3, 2000, logger);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    logger(`[Warning] Failed to download thumbnail: ${e.message}`);
    return null;
  }
}

// Queue marking helper
async function markQueueItemCompleted(item, dateFormatted, isSupabase, queuePath, url, depth, logger) {
  if (isSupabase && item.dbId) {
    try {
      const { error } = await supabase
        .from('queue')
        .update({ status: 'completed' })
        .eq('id', item.dbId);
      if (error) throw error;
      logger(`[Supabase] Queue item marked as completed.`);
    } catch (e) {
      logger(`[Warning] Failed to update queue status in Supabase: ${e.message}`);
    }
  }

  if (fs.existsSync(queuePath)) {
    try {
      const content = fs.readFileSync(queuePath, 'utf8');
      const lines = content.split('\n');
      const pattern = new RegExp(`^\\s*-\\s*\\[\\s*\\]\\s*${url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`);
      
      let foundLine = false;
      const updatedLines = lines.map(line => {
        if (line.match(pattern)) {
          foundLine = true;
          return `- [x] ${url} (Processed: ${dateFormatted}) (Depth: ${depth})`;
        }
        return line;
      });

      if (foundLine) {
        fs.writeFileSync(queuePath, updatedLines.join('\n'), 'utf8');
        logger(`[Queue] Local queue.md updated.`);
      }
    } catch (e) {
      logger(`[Warning] Failed to update local queue.md: ${e.message}`);
    }
  }
}

// Main Queue Ingestion Logic
async function ingestQueue(userId, getUserPaths, logger) {
  const { vaultDir, queuePath, treePath } = getUserPaths(userId);
  const isSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
  let itemsToProcess = [];

  logger(`[Ingest] Starting ingestion run at ${new Date().toISOString()}`);

  // 1. Fetch pending items
  if (isSupabase) {
    logger(`[Ingest] Fetching pending queue items from Supabase for user: ${userId}`);
    try {
      const { data, error } = await supabase
        .from('queue')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending');
      
      if (error) throw error;
      if (data) {
        itemsToProcess = data.map(item => ({
          dbId: item.id,
          url: item.url,
          depth: item.depth || 'Detailed Notes',
          source: 'supabase'
        }));
      }
    } catch (e) {
      logger(`[Error] Supabase queue fetch failed: ${e.message}`);
    }
  }

  // Fallback / sync local queue items
  if (fs.existsSync(queuePath)) {
    try {
      const content = fs.readFileSync(queuePath, 'utf8');
      const lines = content.split('\n');
      const pattern = /^\s*-\s*\[\s*\]\s*(https:\/\/[^\s()]+)(?:\s*\(Added:\s*([^)]+)\))?(?:\s*\(Depth:\s*([^)]+)\))?/;
      
      lines.forEach((line, idx) => {
        const match = line.match(pattern);
        if (match) {
          const url = match[1];
          const depth = match[3] || 'Detailed Notes';
          if (!itemsToProcess.some(item => item.url === url)) {
            itemsToProcess.push({
              lineIdx: idx,
              url,
              depth,
              source: 'local'
            });
          }
        }
      });
    } catch (e) {
      logger(`[Error] Local queue parse failed: ${e.message}`);
    }
  }

  if (itemsToProcess.length === 0) {
    logger(`[Ingest] No unprocessed items found in queue.`);
    return { success: true, processedCount: 0 };
  }

  logger(`[Ingest] Found ${itemsToProcess.length} item(s) to process.`);

  // 2. Fetch existing category paths for LLM reference
  let existingCategories = new Set();
  if (isSupabase) {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('category_path')
        .eq('user_id', userId);
      if (!error && data) {
        data.forEach(n => {
          if (n.category_path && n.category_path.length > 0) {
            existingCategories.add(n.category_path.join(' / '));
          }
        });
      }
    } catch (e) {}
  }
  if (fs.existsSync(treePath)) {
    try {
      const treeData = JSON.parse(fs.readFileSync(treePath, 'utf8'));
      treeData.forEach(n => {
        if (n.categoryPath && n.categoryPath.length > 0) {
          existingCategories.add(n.categoryPath.join(' / '));
        }
      });
    } catch (e) {}
  }
  const existingCategoriesStr = Array.from(existingCategories).map(p => `- ${p}`).join('\n');

  // Check API keys
  const geminiKey = process.env.GEMINI_API_KEY;
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const apifyToken = process.env.APIFY_TOKEN;

  if (!geminiKey && !nvidiaKey) {
    logger(`[Error] Ingestion aborted. GEMINI_API_KEY or NVIDIA_API_KEY is required.`);
    return { success: false, error: 'API key is missing.' };
  }

  let processedCount = 0;
  const processedUrls = new Map(); // Cache processed URLs in current session to skip duplicate runs
  let distinctUrlsProcessed = 0;

  for (const item of itemsToProcess) {
    const { url, depth } = item;
    const dateFormatted = new Date().toISOString().replace('T', ' ').substring(0, 16);

    // Skip duplicates
    if (processedUrls.has(url)) {
      logger(`[Ingest] URL ${url} was already processed in this run. Reusing cached result.`);
      await markQueueItemCompleted(item, dateFormatted, isSupabase, queuePath, url, depth, logger);
      processedCount++;
      continue;
    }

    // Limit to processing at most 1 distinct new URL per run on Vercel (cloud mode) to prevent 60s timeout
    if (isSupabase && distinctUrlsProcessed >= 1) {
      logger(`[Ingest] Bypassing ${url} in this run to prevent execution timeout. It will be processed in the next run.`);
      continue;
    }

    // Politeness delay
    if (processedCount > 0) {
      logger(`[Ingest] Waiting 2 seconds before the next item to prevent rate-limiting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger(`[Ingest] Processing URL: ${url} (Depth: ${depth})`);
    distinctUrlsProcessed++;

    let scrapedMeta = null;

    // Platform Routing
    if (url.includes('instagram.com')) {
      if (apifyToken) {
        const dataset = await runApifyActorSync('apify/instagram-scraper', {
          directUrls: [url],
          resultsLimit: 1,
          resultsType: 'details'
        }, apifyToken, logger);
        
        if (dataset && dataset[0]) {
          const resItem = dataset[0];
          scrapedMeta = {
            title: resItem.caption || 'Instagram Post',
            description: resItem.caption || '',
            displayUrl: resItem.displayUrl || resItem.thumbnailUrl || '',
            ownerUsername: resItem.ownerUsername || 'Instagram User'
          };
        }
      } else {
        logger(`[Warning] Instagram URL detected but APIFY_TOKEN is missing. Skipping scraping.`);
      }
    } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
      if (apifyToken) {
        const dataset = await runApifyActorSync('apify/facebook-reels-scraper', {
          startUrls: [{ url }],
          resultsLimit: 1
        }, apifyToken, logger);
        
        if (dataset && dataset[0]) {
          const resItem = dataset[0];
          scrapedMeta = {
            title: resItem.caption || resItem.title || 'Facebook Video',
            description: resItem.caption || resItem.text || resItem.description || '',
            displayUrl: resItem.thumbnail || resItem.thumbnailUrl || resItem.thumbnail_url || resItem.image || '',
            ownerUsername: resItem.ownerUsername || resItem.author || resItem.pageName || 'Facebook Page'
          };
        }
      } else {
        logger(`[Warning] Facebook URL detected but APIFY_TOKEN is missing. Skipping scraping.`);
      }
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      // First try fallback scraper for YouTube
      scrapedMeta = await getYouTubeMetadataFallback(url, logger);
      
      // In cloud mode, skip the slow Apify YouTube Scraper if the fallback scraper successfully retrieved a title.
      // This keeps execution fast and prevents Vercel serverless function timeouts.
      const needsApifyFallback = isSupabase 
        ? (!scrapedMeta || !scrapedMeta.title)
        : (!scrapedMeta || !scrapedMeta.description);

      if (needsApifyFallback && apifyToken) {
        logger(`[Ingest] Falling back to Apify YouTube Scraper for deeper analysis...`);
        const dataset = await runApifyActorSync('apify/youtube-scraper', {
          startUrls: [{ url }],
          maxResults: 1
        }, apifyToken, logger);
        
        if (dataset && dataset[0]) {
          const resItem = dataset[0];
          scrapedMeta = {
            title: resItem.title || scrapedMeta?.title || 'YouTube Video',
            description: resItem.description || scrapedMeta?.description || '',
            displayUrl: resItem.thumbnailUrl || scrapedMeta?.displayUrl || '',
            ownerUsername: resItem.channelName || scrapedMeta?.ownerUsername || 'YouTube Channel'
          };
        }
      }
    } else {
      // General webpage fallback
      logger(`[Ingest] General webpage detected. Fetching page headers...`);
      try {
        const res = await fetchWithRetry(url, {}, 3, 2000, logger);
        const html = await res.text();
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
        scrapedMeta = {
          title: titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Webpage',
          description: descMatch ? decodeHtmlEntities(descMatch[1]) : '',
          displayUrl: '',
          ownerUsername: new URL(url).hostname
        };
      } catch (e) {
        logger(`[Warning] Webpage fetch failed: ${e.message}`);
      }
    }

    if (!scrapedMeta) {
      logger(`[Error] Failed to retrieve any metadata for: ${url}. Marking as processed to prevent blocking.`);
      await markQueueItemCompleted(item, dateFormatted, isSupabase, queuePath, url, depth, logger);
      processedCount++;
      continue;
    }

    // Call LLM for note structuring
    const prompt = `You are an expert research and Personal Knowledge Management assistant. Your job is to analyze this video and produce a structured Markdown note for Obsidian.

Metadata scraped from the post:
Owner/Author: ${scrapedMeta.ownerUsername || 'Unknown'}
Post Title/Caption/Description:
${scrapedMeta.description || scrapedMeta.title || ''}

Create a note at the requested depth level: '${depth}'.

Here are the existing category paths in the vault for reference:
${existingCategoriesStr}

Decide on the best categoryPath hierarchy for this note (max 2 levels deep, e.g. ['AI', 'New Tech Stack'] or ['Food', 'Recipes']). 
Align with existing categories if they fit, otherwise create a new one. Do not put slashes or backslashes in path strings.

Format the 'markdown' field exactly as follows based on depth:
- 'Quick Summary': High-level bullet points of key takeaways (~100-200 words).
- 'Detailed Notes': Deep dive into subtopics, core concepts, arguments, tools mentioned, and structure (~500 words).
- 'Fine-Grained Study': Extremely comprehensive step-by-step breakdown, caption breakdown, visual cues/overlays, full quotes, key learnings, and direct action items.

Return the response strictly inside the JSON schema.`;

    let responseJson = null;
    try {
      if (nvidiaKey) {
        logger(`[LLM] Calling NVIDIA NIM API (Llama-3.1-70b-instruct)...`);
        const res = await fetchWithRetry('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${nvidiaKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-70b-instruct',
            messages: [
              {
                role: 'user',
                content: prompt + "\nRespond strictly in valid JSON format matching this schema:\n{\n  \"title\": \"A clean, concise title for the note (string)\",\n  \"categoryPath\": [\"Category\", \"Subcategory\"] (array of 1-2 strings),\n  \"tags\": [\"tag1\", \"tag2\"] (array of 3-5 strings),\n  \"snippet\": \"A brief 20-30 word summary snippet for the index (string)\",\n  \"markdown\": \"The complete structured note content in Markdown. Do not include YAML frontmatter. (string)\"\n}"
              }
            ],
            temperature: 0.2,
            max_tokens: 2048
          })
        }, 3, 2000, logger);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        const rawContent = data.choices[0].message.content.trim();
        const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/) || rawContent.match(/```\s*([\s\S]*?)\s*```/);
        const jsonString = jsonMatch ? jsonMatch[1].trim() : rawContent;
        responseJson = parseRobustJson(jsonString);
      } else if (geminiKey) {
        logger(`[LLM] Calling Gemini API (gemini-2.5-flash)...`);
        const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  categoryPath: { type: 'ARRAY', items: { type: 'STRING' } },
                  tags: { type: 'ARRAY', items: { type: 'STRING' } },
                  snippet: { type: 'STRING' },
                  markdown: { type: 'STRING' }
                },
                required: ['title', 'categoryPath', 'tags', 'snippet', 'markdown']
              }
            }
          })
        }, 3, 2000, logger);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        responseJson = JSON.parse(data.candidates[0].content.parts[0].text);
      }
    } catch (e) {
      logger(`[Error] LLM analysis failed: ${e.message}`);
      continue;
    }

    if (!responseJson) {
      logger(`[Error] Empty response from LLM API. Skipping.`);
      continue;
    }

    // Parse note properties
    const title = responseJson.title || responseJson.Title || 'Untitled Note';
    let categoryPath = responseJson.categoryPath || responseJson.category_path || responseJson.CategoryPath || ['General'];
    const tags = responseJson.tags || responseJson.Tags || [];
    const snippet = responseJson.snippet || responseJson.Snippet || '';
    const markdownBody = responseJson.markdown || responseJson.Markdown || responseJson.content || '';

    if (categoryPath.length > 2) categoryPath = categoryPath.slice(0, 2);
    if (categoryPath.length === 0) categoryPath = ['General'];

    const sanitizedTitle = sanitizeFilename(title);
    const filename = `${sanitizedTitle}.md`;
    const noteId = `${sanitizedTitle}_${Math.floor(Date.now() / 1000)}`;
    const relativeFilePath = `vault/${userId}/${categoryPath.join('/')}/${filename}`.replace(/\\/g, '/');

    // Create note frontmatter
    const frontmatter = `---\ntitle: "${title}"\nsource: ${url}\ndate_processed: ${dateFormatted}\ntags: ${JSON.stringify(tags)}\ncategory: "${categoryPath.join(' / ')}"\n---\n\n`;
    const fullMarkdown = frontmatter + markdownBody;

    // Handle thumbnail
    let localThumbnailUrl = '';
    if (scrapedMeta.displayUrl) {
      const buffer = await downloadImageToBuffer(scrapedMeta.displayUrl, logger);
      if (buffer) {
        if (isSupabase) {
          // Cloud mode: Upload directly to Supabase Storage (no local write)
          logger(`[Supabase] Uploading thumbnail to Supabase storage bucket...`);
          try {
            const thumbFilename = `${sanitizedTitle}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('thumbnails')
              .upload(thumbFilename, buffer, {
                contentType: 'image/jpeg',
                upsert: true
              });
            if (uploadError) throw uploadError;
            localThumbnailUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${thumbFilename}`;
            logger(`[Supabase] Thumbnail uploaded: ${localThumbnailUrl}`);
          } catch (se) {
            logger(`[Warning] Supabase storage upload failed: ${se.message}. Using original URL as fallback.`);
            localThumbnailUrl = scrapedMeta.displayUrl || '';
          }
        } else {
          // Local mode: Save to local vault directory
          try {
            const thumbnailDir = path.join(vaultDir, 'thumbnails');
            fs.mkdirSync(thumbnailDir, { recursive: true });
            const thumbLocalPath = path.join(thumbnailDir, `${sanitizedTitle}.jpg`);
            fs.writeFileSync(thumbLocalPath, buffer);
            localThumbnailUrl = `/api/vault/${userId}/thumbnails/${sanitizedTitle}.jpg`;
          } catch (localErr) {
            logger(`[Warning] Failed to save thumbnail locally: ${localErr.message}`);
            localThumbnailUrl = scrapedMeta.displayUrl || '';
          }
        }
      }
    }


    // Save note record
    if (isSupabase) {
      logger(`[Supabase] Saving note to PostgreSQL...`);
      try {
        const record = {
          id: noteId,
          user_id: userId,
          title,
          url,
          tags,
          category_path: categoryPath,
          snippet,
          date_processed: new Date().toISOString(),
          markdown_content: fullMarkdown,
          thumbnail_url: localThumbnailUrl || scrapedMeta.displayUrl || '',
          file_path: relativeFilePath
        };

        const { error } = await supabase
          .from('notes')
          .upsert(record);
        if (error) throw error;
        logger(`[Supabase] Note saved successfully.`);
      } catch (e) {
        logger(`[Error] Failed to save note in Supabase: ${e.message}`);
      }
    }

    // Save locally for vault synchronization (Obsidian integration)
    try {
      const noteDir = path.join(vaultDir, ...categoryPath);
      fs.mkdirSync(noteDir, { recursive: true });
      fs.writeFileSync(path.join(noteDir, filename), fullMarkdown, 'utf8');

      // Update tree.json
      let treeData = [];
      if (fs.existsSync(treePath)) {
        try {
          treeData = JSON.parse(fs.readFileSync(treePath, 'utf8'));
        } catch (e) {}
      }

      const nodeMetadata = {
        id: noteId,
        title,
        url,
        tags,
        categoryPath,
        snippet,
        dateProcessed: dateFormatted,
        filePath: relativeFilePath,
        thumbnailUrl: localThumbnailUrl || scrapedMeta.displayUrl || ''
      };

      const existingIdx = treeData.findIndex(n => n.url === url);
      if (existingIdx !== -1) {
        treeData[existingIdx] = nodeMetadata;
      } else {
        treeData.push(nodeMetadata);
      }

      fs.writeFileSync(treePath, JSON.stringify(treeData, null, 2), 'utf8');
      logger(`[Vault] Successfully saved note to: ${relativeFilePath}`);
    } catch (e) {
      logger(`[Error] Failed to write local note: ${e.message}`);
    }

    // Mark as processed in queue
    await markQueueItemCompleted(item, dateFormatted, isSupabase, queuePath, url, depth, logger);

    // Cache the processed note metadata so duplicates can reuse it
    processedUrls.set(url, {
      title,
      categoryPath,
      tags,
      snippet,
      relativeFilePath,
      localThumbnailUrl,
      displayUrl: scrapedMeta.displayUrl || ''
    });

    processedCount++;
    logger(`[Success] Processed item ${processedCount}/${itemsToProcess.length}`);
  }

  // Calculate remaining count of pending items
  let remainingCount = 0;
  if (isSupabase) {
    try {
      const { count, error } = await supabase
        .from('queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending');
      if (!error) {
        remainingCount = count || 0;
      }
    } catch (e) {
      logger(`[Warning] Failed to fetch remaining queue count: ${e.message}`);
    }
  } else {
    if (fs.existsSync(queuePath)) {
      try {
        const content = fs.readFileSync(queuePath, 'utf8');
        const lines = content.split('\n');
        const pattern = /^\s*-\s*\[\s*\]\s*(https:\/\/[^\s()]+)/;
        lines.forEach(line => {
          if (line.match(pattern)) remainingCount++;
        });
      } catch (e) {}
    }
  }

  logger(`[Ingest] Ingestion completed. Processed ${processedCount} item(s). Remaining pending items: ${remainingCount}`);
  return { success: true, processedCount, remainingCount };
}

module.exports = {
  ingestQueue
};
