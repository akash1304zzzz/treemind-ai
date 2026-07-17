/**
 * admin.js — Admin Dashboard API routes for TreeMind AI
 *
 * All routes are behind adminMiddleware (checks x-admin-password header).
 * Uses the Supabase service-role client for full access.
 * Admin writes are logged to the audit_log table.
 */

const express = require('express');
const supabase = require('./supabaseClient');

const router = express.Router();

// ── Admin password (default: admin123; override with ADMIN_PASSWORD env) ──
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ── Middleware ──
function adminMiddleware(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.admin_password;
  if (pw === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Invalid admin password.' });
  }
}

router.use(adminMiddleware);

// ── Audit log helper ──
async function auditLog(actor, action, detail) {
  try {
    await supabase.from('audit_log').insert({ actor, action, detail });
  } catch (_) { /* best-effort */ }
}

// ── Get effective monthly limit for a user ──
async function getEffectiveLimit(userId) {
  try {
    // 1. Check per-user setting in users table
    const { data: user } = await supabase.from('users')
      .select('monthly_limit, is_disabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (user && user.monthly_limit != null) return user.monthly_limit;
  } catch (_) {}

  try {
    // 2. Check global setting
    const { data: setting } = await supabase.from('app_settings')
      .select('value')
      .eq('key', 'global_monthly_limit')
      .maybeSingle();
    if (setting && setting.value) return parseInt(setting.value, 10);
  } catch (_) {}

  return 20; // fallback
}

// ══════════════════════════════════════════════════════════════════════════
// 1. GET /api/admin/stats — aggregate dashboard stats
// ══════════════════════════════════════════════════════════════════════════
router.get('/stats', async (_req, res) => {
  try {
    // Total users
    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Total notes
    const { count: totalNotes } = await supabase
      .from('notes')
      .select('*', { count: 'exact', head: true });

    // Notes this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count: monthNotes } = await supabase
      .from('notes')
      .select('*', { count: 'exact', head: true })
      .gte('date_processed', startOfMonth.toISOString());

    // Pending queue
    const { count: pendingQueue } = await supabase
      .from('queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Notes per user
    const { data: perUser } = await supabase
      .from('notes')
      .select('user_id');
    const perUserCounts = {};
    (perUser || []).forEach(n => {
      perUserCounts[n.user_id] = (perUserCounts[n.user_id] || 0) + 1;
    });

    res.json({
      userCount: userCount || 0,
      totalNotes: totalNotes || 0,
      monthNotes: monthNotes || 0,
      pendingQueue: pendingQueue || 0,
      perUserCounts
    });
  } catch (err) {
    console.error('[Admin Stats Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. GET /api/admin/users — list all users
// ══════════════════════════════════════════════════════════════════════════
router.get('/users', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
    if (error) throw error;

    // Enrich with this-month note counts
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: recentNotes } = await supabase
      .from('notes')
      .select('user_id')
      .gte('date_processed', startOfMonth.toISOString());

    const monthCounts = {};
    (recentNotes || []).forEach(n => {
      monthCounts[n.user_id] = (monthCounts[n.user_id] || 0) + 1;
    });

    const enriched = (data || []).map(u => ({
      ...u,
      monthNoteCount: monthCounts[u.user_id] || 0
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Admin Users Get Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. POST /api/admin/users — create a user
// ══════════════════════════════════════════════════════════════════════════
router.post('/users', async (req, res) => {
  const { user_id, display_name, monthly_limit } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

  try {
    const { data, error } = await supabase.from('users')
      .upsert({
        user_id,
        display_name: display_name || user_id,
        monthly_limit: monthly_limit || 20,
        is_disabled: false,
      }, { onConflict: 'user_id' });
    if (error) throw error;

    await auditLog('admin', 'user_created', `Created user ${user_id}, limit ${monthly_limit || 20}`);
    res.json({ success: true, user: data[0] });
  } catch (err) {
    console.error('[Admin User Create Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. PATCH /api/admin/users/:id — update a user (limit, name, disabled)
// ══════════════════════════════════════════════════════════════════════════
router.patch('/users/:id', async (req, res) => {
  const userId = req.params.id;
  const { display_name, monthly_limit, is_disabled } = req.body;

  try {
    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (monthly_limit !== undefined) updates.monthly_limit = monthly_limit;
    if (is_disabled !== undefined) updates.is_disabled = is_disabled;

    const { data, error } = await supabase.from('users')
      .update(updates)
      .eq('user_id', userId)
      .select();
    if (error) throw error;

    await auditLog('admin', 'user_updated', `Updated ${userId}: ${JSON.stringify(updates)}`);
    res.json({ success: true, user: data[0] });
  } catch (err) {
    console.error('[Admin User Update Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. DELETE /api/admin/users/:id — disable a user (soft delete)
// ══════════════════════════════════════════════════════════════════════════
router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    const { data, error } = await supabase.from('users')
      .update({ is_disabled: true })
      .eq('user_id', userId)
      .select();
    if (error) throw error;

    await auditLog('admin', 'user_disabled', `Disabled user ${userId}`);
    res.json({ success: true, user: data[0] });
  } catch (err) {
    console.error('[Admin User Delete Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 6. GET /api/admin/settings — read app-wide settings
// ══════════════════════════════════════════════════════════════════════════
router.get('/settings', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (error) throw error;

    const settings = {};
    (data || []).forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    console.error('[Admin Settings Get Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 7. PUT /api/admin/settings — update app-wide settings (persisted to DB)
// ══════════════════════════════════════════════════════════════════════════
router.put('/settings', async (req, res) => {
  const { global_monthly_limit, gemini_api_key, nvidia_api_key, apify_token, app_password } = req.body;

  try {
    const upserts = [];
    if (global_monthly_limit !== undefined) upserts.push({ key: 'global_monthly_limit', value: String(global_monthly_limit) });
    if (gemini_api_key !== undefined) upserts.push({ key: 'gemini_api_key', value: gemini_api_key });
    if (nvidia_api_key !== undefined) upserts.push({ key: 'nvidia_api_key', value: nvidia_api_key });
    if (apify_token !== undefined) upserts.push({ key: 'apify_token', value: apify_token });
    if (app_password !== undefined) upserts.push({ key: 'app_password', value: app_password });

    if (upserts.length > 0) {
      const { error } = await supabase.from('app_settings').upsert(upserts, { onConflict: 'key' });
      if (error) throw error;
    }

    // Also update in-memory env so running server picks it up
    if (global_monthly_limit !== undefined) process.env.GLOBAL_MONTHLY_LIMIT = String(global_monthly_limit);
    if (gemini_api_key !== undefined) process.env.GEMINI_API_KEY = gemini_api_key;
    if (nvidia_api_key !== undefined) process.env.NVIDIA_API_KEY = nvidia_api_key;
    if (apify_token !== undefined) process.env.APIFY_TOKEN = apify_token;
    if (app_password !== undefined) process.env.APP_PASSWORD = app_password;

    await auditLog('admin', 'settings_updated', `Updated ${upserts.length} settings`);
    res.json({ success: true, message: 'Settings updated.' });
  } catch (err) {
    console.error('[Admin Settings Put Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 8. GET /api/admin/notes — all notes across users (paginated)
// ══════════════════════════════════════════════════════════════════════════
router.get('/notes', async (req, res) => {
  const { user_id, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = supabase.from('notes').select('id, title, url, user_id, snippet, date_processed, tags, category_path, thumbnail_url', { count: 'exact' });
    if (user_id) query = query.eq('user_id', user_id);
    query = query.order('date_processed', { ascending: false }).range(offset, offset + parseInt(limit) - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      notes: (data || []).map(n => ({
        id: n.id,
        title: n.title,
        url: n.url,
        user_id: n.user_id,
        snippet: n.snippet,
        dateProcessed: n.date_processed,
        tags: n.tags,
        categoryPath: n.category_path,
        thumbnailUrl: n.thumbnail_url
      })),
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('[Admin Notes Get Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 9. DELETE /api/admin/notes/:id — delete any note (admin override)
// ══════════════════════════════════════════════════════════════════════════
router.delete('/notes/:id', async (req, res) => {
  const noteId = req.params.id;
  try {
    // Find note first for audit
    const { data: note } = await supabase.from('notes')
      .select('id, title, user_id')
      .eq('id', noteId)
      .maybeSingle();
    if (!note) return res.status(404).json({ error: 'Note not found.' });

    // Delete from DB
    const { error } = await supabase.from('notes').delete().eq('id', noteId);
    if (error) throw error;

    // Try to remove thumbnail
    try {
      await supabase.storage.from('thumbnails').remove([`${noteId}.jpg`]);
    } catch (_) {}

    await auditLog('admin', 'note_deleted', `Deleted note ${noteId} (${note.title}) from user ${note.user_id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin Note Delete Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 10. GET /api/admin/queue — full queue across users
// ══════════════════════════════════════════════════════════════════════════
router.get('/queue', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('queue')
      .select('*')
      .order('date_added', { ascending: false });

    if (error) throw error;

    res.json((data || []).map(item => ({
      id: item.id,
      user_id: item.user_id,
      url: item.url,
      depth: item.depth,
      status: item.status,
      date_added: item.date_added
    })));
  } catch (err) {
    console.error('[Admin Queue Get Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 11. POST /api/admin/ingest — trigger ingest for a specific user (streaming)
// ══════════════════════════════════════════════════════════════════════════
router.post('/ingest', async (req, res) => {
  const userId = req.body.user_id || req.headers['x-user-id'] || 'default';
  const { ingestQueue } = require('./ingest');

  // getUserPaths from the main app
  const path = require('path');
  const fs = require('fs');
  function getUserPaths(uid) {
    const safeUid = uid ? uid.replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
    const vaultDir = path.join(__dirname, '../vault', safeUid);
    const queuePath = path.join(vaultDir, 'queue.md');
    const treePath = path.join(vaultDir, 'tree.json');
    try {
      if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
      if (!fs.existsSync(treePath)) fs.writeFileSync(treePath, '[]', 'utf8');
      if (!fs.existsSync(queuePath)) fs.writeFileSync(queuePath, '# Queue\n\n', 'utf8');
    } catch (_) {}
    return { vaultDir, queuePath, treePath, userId: safeUid };
  }

  console.log(`[Admin] Triggering ingestion for user: ${userId}...`);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const logCallback = (msg) => {
    try { res.write(msg + '\n'); } catch (_) {}
  };
  const heartbeat = setInterval(() => {
    try { res.write(' \n'); } catch (_) {}
  }, 4000);

  try {
    const result = await ingestQueue(userId, getUserPaths, logCallback);
    const metadata = result.success
      ? { success: true, remainingCount: result.remainingCount || 0 }
      : { success: false, error: result.error };
    res.write('__METADATA__:' + JSON.stringify(metadata) + '\n');
    await auditLog('admin', 'ingest_triggered', `Triggered ingest for ${userId}: ${result.success ? 'success' : result.error}`);
  } catch (err) {
    res.write(`[Error] ${err.message}\n`);
    res.write('__METADATA__:' + JSON.stringify({ success: false, error: err.message }) + '\n');
  } finally {
    clearInterval(heartbeat);
    try { res.end(); } catch (_) {}
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 12. GET /api/admin/audit — recent admin actions
// ══════════════════════════════════════════════════════════════════════════
router.get('/audit', async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const { data, error } = await supabase.from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Admin Audit Get Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, adminMiddleware, getEffectiveLimit, ADMIN_PASSWORD };
