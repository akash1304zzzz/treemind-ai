import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, BarChart3, Settings, FileText, Clock, Shield,
  Trash2, Edit2, Play, Plus, CheckCircle, XCircle, AlertTriangle,
  RefreshCw
} from 'lucide-react';

const ADMIN_HEADERS = {
  'x-admin-password': '',
  'Content-Type': 'application/json',
};

// ── Responsive breakpoint helper ──
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < breakpoint
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

export default function AdminView({ adminPassword, apiUrl }) {
  const mobile = useIsMobile();

  // State
  const [activeTab, setActiveTab] = useState('stats');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [notes, setNotes] = useState([]);
  const [queue, setQueue] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState('');

  // Form states
  const [newUser, setNewUser] = useState({ user_id: '', display_name: '', monthly_limit: '20' });
  const [editSettings, setEditSettings] = useState({ global_monthly_limit: '', gemini_api_key: '', nvidia_api_key: '', apify_token: '', app_password: '' });
  const [notesPage, setNotesPage] = useState(1);
  const [notesFilter, setNotesFilter] = useState('');
  const [ingestLogs, setIngestLogs] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestUser, setIngestUser] = useState('');

  const headers = { ...ADMIN_HEADERS, 'x-admin-password': adminPassword };

  // Generic fetch helper
  const adminFetch = useCallback(async (path, options = {}) => {
    const res = await fetch(`${apiUrl}/api/admin${path}`, { headers, ...options });
    if (res.status === 401) throw new Error('Invalid admin password');
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  }, [adminPassword, apiUrl]);

  // ── Load data ──
  const loadStats = useCallback(async () => {
    setLoading(p => ({ ...p, stats: true }));
    try { setStats(await adminFetch('/stats')); setError(''); }
    catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, stats: false }));
  }, [adminFetch]);

  const loadUsers = useCallback(async () => {
    setLoading(p => ({ ...p, users: true }));
    try { setUsers(await adminFetch('/users')); setError(''); }
    catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, users: false }));
  }, [adminFetch]);

  const loadSettings = useCallback(async () => {
    setLoading(p => ({ ...p, settings: true }));
    try {
      const s = await adminFetch('/settings');
      setSettings(s);
      setEditSettings({ global_monthly_limit: s.global_monthly_limit || '', gemini_api_key: s.gemini_api_key || '', nvidia_api_key: s.nvidia_api_key || '', apify_token: s.apify_token || '', app_password: s.app_password || '' });
      setError('');
    } catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, settings: false }));
  }, [adminFetch]);

  const loadNotes = useCallback(async (page = 1, userId = '') => {
    setLoading(p => ({ ...p, notes: true }));
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (userId) params.set('user_id', userId);
      const data = await adminFetch(`/notes?${params}`);
      setNotes(data); setError('');
    } catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, notes: false }));
  }, [adminFetch]);

  const loadQueue = useCallback(async () => {
    setLoading(p => ({ ...p, queue: true }));
    try { setQueue(await adminFetch('/queue')); setError(''); }
    catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, queue: false }));
  }, [adminFetch]);

  const loadAudit = useCallback(async () => {
    setLoading(p => ({ ...p, audit: true }));
    try { setAuditLog(await adminFetch('/audit?limit=100')); setError(''); }
    catch (e) { setError(e.message); }
    setLoading(p => ({ ...p, audit: false }));
  }, [adminFetch]);

  // Auto-load based on tab
  useEffect(() => {
    if (activeTab === 'stats') loadStats();
    else if (activeTab === 'users') loadUsers();
    else if (activeTab === 'settings') loadSettings();
    else if (activeTab === 'content') { loadNotes(1); loadQueue(); }
    else if (activeTab === 'audit') loadAudit();
  }, [activeTab, loadStats, loadUsers, loadSettings, loadNotes, loadQueue, loadAudit]);

  // ── Actions ──
  const handleCreateUser = async () => {
    if (!newUser.user_id) return;
    try {
      await adminFetch('/users', { method: 'POST', body: JSON.stringify(newUser) });
      setNewUser({ user_id: '', display_name: '', monthly_limit: '20' });
      loadUsers(); loadStats();
    } catch (e) { setError(e.message); }
  };

  const handleToggleDisable = async (userId, isDisabled) => {
    try {
      await adminFetch(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ is_disabled: !isDisabled }) });
      loadUsers();
    } catch (e) { setError(e.message); }
  };

  const handleUpdateUserLimit = async (userId, newLimit) => {
    try {
      await adminFetch(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ monthly_limit: parseInt(newLimit, 10) }) });
      loadUsers();
    } catch (e) { setError(e.message); }
  };

  const handleDeleteNote = async (noteId) => {
    if (!confirm(`Delete note ${noteId}?`)) return;
    try {
      await adminFetch(`/notes/${noteId}`, { method: 'DELETE' });
      loadNotes(notesPage, notesFilter);
      loadStats();
    } catch (e) { setError(e.message); }
  };

  const handleSaveSettings = async () => {
    try {
      const body = {};
      if (editSettings.global_monthly_limit) body.global_monthly_limit = parseInt(editSettings.global_monthly_limit, 10);
      if (editSettings.gemini_api_key) body.gemini_api_key = editSettings.gemini_api_key;
      if (editSettings.nvidia_api_key) body.nvidia_api_key = editSettings.nvidia_api_key;
      if (editSettings.apify_token) body.apify_token = editSettings.apify_token;
      if (editSettings.app_password) body.app_password = editSettings.app_password;
      await adminFetch('/settings', { method: 'PUT', body: JSON.stringify(body) });
      setError('');
      alert('Settings saved.');
      loadSettings();
    } catch (e) { setError(e.message); }
  };

  const handleIngest = async () => {
    if (!ingestUser) return;
    setIngesting(true); setIngestLogs('Starting ingestion...\n');
    try {
      const res = await fetch(`${apiUrl}/api/admin/ingest`, {
        method: 'POST', headers,
        body: JSON.stringify({ user_id: ingestUser }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        setIngestLogs(buffer);
      }
    } catch (e) { setIngestLogs(prev => prev + `\nError: ${e.message}`); }
    setIngesting(false);
  };

  // ── Tabs ──
  const tabs = [
    { key: 'stats', label: mobile ? 'Stats' : 'Stats', icon: <BarChart3 size={mobile ? 14 : 16} /> },
    { key: 'users', label: 'Users', icon: <Users size={mobile ? 14 : 16} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={mobile ? 14 : 16} /> },
    { key: 'content', label: 'Content', icon: <FileText size={mobile ? 14 : 16} /> },
    { key: 'audit', label: 'Audit', icon: <Shield size={mobile ? 14 : 16} /> },
  ];

  return (
    <div style={{ maxWidth: mobile ? '100%' : 1100, margin: '0 auto', padding: mobile ? '0 4px' : '0' }}>
      {/* Tab bar — sticky, wraps on mobile */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: mobile ? 4 : 6, marginBottom: mobile ? 16 : 24,
        borderBottom: '1px solid var(--border-color)', paddingBottom: 12,
        position: 'sticky', top: 0, background: 'var(--bg-deep)', zIndex: 10, backdropFilter: 'blur(12px)'
      }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              padding: mobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: '1px solid transparent',
              background: activeTab === t.key ? 'var(--bg-elevated)' : 'transparent',
              color: activeTab === t.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === t.key ? 600 : 400,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: mobile ? 4 : 6,
              fontSize: mobile ? 12 : 14, flexShrink: 0,
              boxShadow: activeTab === t.key ? 'var(--shadow-sm)' : 'none',
              whiteSpace: 'nowrap'
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: mobile ? '10px 12px' : '12px 16px', marginBottom: 16, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}><XCircle size={16} /></button>
        </div>
      )}

      {/* ═══ STATS TAB ═══ */}
      {activeTab === 'stats' && (
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: mobile ? 10 : 16 }}>
          {[
            { label: 'Total Users', value: stats?.userCount ?? '-', color: 'var(--accent-primary)' },
            { label: 'Total Notes', value: stats?.totalNotes ?? '-', color: '#8b5cf6' },
            { label: 'This Month', value: stats?.monthNotes ?? '-', color: '#10b981' },
            { label: 'Queue', value: stats?.pendingQueue ?? '-', color: '#f59e0b' },
          ].map((t, i) => (
            <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 16 : 24, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: mobile ? 11 : 13, marginBottom: 6 }}>{t.label}</div>
              <div style={{ fontSize: mobile ? 26 : 32, fontWeight: 700, color: t.color }}>{t.value}</div>
            </div>
          ))}
          {stats?.perUserCounts && Object.keys(stats.perUserCounts).length > 0 && (
            <div style={{ gridColumn: '1 / -1', background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 14 : 20, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Notes per User</div>
              <div style={{ display: 'flex', gap: mobile ? 8 : 12, flexWrap: 'wrap' }}>
                {Object.entries(stats.perUserCounts).sort((a, b) => b[1] - a[1]).map(([uid, count]) => (
                  <div key={uid} style={{ padding: '6px 12px', background: 'var(--bg-base)', borderRadius: 6, fontSize: mobile ? 12 : 13 }}>
                    <span style={{ fontWeight: 600 }}>{uid}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading.stats && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading...</div>}
        </div>
      )}

      {/* ═══ USERS TAB ═══ */}
      {activeTab === 'users' && (
        <div>
          {/* Create user form */}
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 14 : 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Create User</div>
            <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: mobile ? 10 : 12, alignItems: mobile ? 'stretch' : 'end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>User ID</label>
                <input value={newUser.user_id} onChange={e => setNewUser(p => ({ ...p, user_id: e.target.value }))}
                  placeholder="e.g. user_42" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Display Name</label>
                <input value={newUser.display_name} onChange={e => setNewUser(p => ({ ...p, display_name: e.target.value }))}
                  placeholder="e.g. John" style={inputStyle} />
              </div>
              <div style={mobile ? {} : { width: 100 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Monthly Limit</label>
                <input type="number" value={newUser.monthly_limit} onChange={e => setNewUser(p => ({ ...p, monthly_limit: e.target.value }))}
                  style={inputStyle} />
              </div>
              <button onClick={handleCreateUser} style={{ ...btnStyle, background: 'var(--accent-primary)', color: '#fff', justifyContent: 'center', width: mobile ? '100%' : 'auto' }}>
                <Plus size={14} /> Create
              </button>
            </div>
          </div>

          {/* Users table — cards on mobile, table on desktop */}
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            {mobile ? (
              /* Mobile: card layout */
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(users || []).map(u => (
                  <div key={u.user_id} style={{ padding: 14, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-base)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <strong style={{ fontSize: 14 }}>{u.user_id}</strong>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: u.is_disabled ? '#fef2f2' : '#ecfdf5', color: u.is_disabled ? '#dc2626' : '#059669' }}>
                        {u.is_disabled ? <XCircle size={12} /> : <CheckCircle size={12} />}
                        {u.is_disabled ? 'Disabled' : 'Active'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      {u.display_name}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                      <span>{u.monthNoteCount} / {u.monthly_limit} this month</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="number" value={u.monthly_limit} onChange={e => handleUpdateUserLimit(u.user_id, e.target.value)}
                          style={{ width: 50, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-color)', fontSize: 13, textAlign: 'center' }} />
                        <button onClick={() => handleToggleDisable(u.user_id, u.is_disabled)}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            color: u.is_disabled ? '#059669' : '#dc2626' }}>
                          {u.is_disabled ? 'Enable' : 'Disable'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Desktop: table layout */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-base)', textAlign: 'left' }}>
                      <th style={thStyle}>User ID</th>
                      <th style={thStyle}>Display Name</th>
                      <th style={thStyle}>This Month</th>
                      <th style={thStyle}>Monthly Limit</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users || []).map(u => (
                      <tr key={u.user_id} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={tdStyle}><strong>{u.user_id}</strong></td>
                        <td style={tdStyle}>{u.display_name}</td>
                        <td style={tdStyle}>{u.monthNoteCount} / {u.monthly_limit}</td>
                        <td style={tdStyle}>
                          <input type="number" value={u.monthly_limit} onChange={e => handleUpdateUserLimit(u.user_id, e.target.value)}
                            style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-color)', fontSize: 13 }} />
                        </td>
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: u.is_disabled ? '#fef2f2' : '#ecfdf5', color: u.is_disabled ? '#dc2626' : '#059669' }}>
                            {u.is_disabled ? <XCircle size={12} /> : <CheckCircle size={12} />}
                            {u.is_disabled ? 'Disabled' : 'Active'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                        <td style={tdStyle}>
                          <button onClick={() => handleToggleDisable(u.user_id, u.is_disabled)}
                            style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: 12, color: u.is_disabled ? '#059669' : '#dc2626' }}>
                            {u.is_disabled ? 'Enable' : 'Disable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {loading.users && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>}
          </div>
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {activeTab === 'settings' && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 16 : 24, boxShadow: 'var(--shadow-sm)', maxWidth: 500 }}>
          <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 16 }}>App-Wide Settings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
            <SettingField label="Global Monthly Limit" type="number"
              value={editSettings.global_monthly_limit}
              onChange={e => setEditSettings(p => ({ ...p, global_monthly_limit: e.target.value }))} />
            <SettingField label="Gemini API Key" type="password"
              value={editSettings.gemini_api_key}
              onChange={e => setEditSettings(p => ({ ...p, gemini_api_key: e.target.value }))} />
            <SettingField label="NVIDIA API Key" type="password"
              value={editSettings.nvidia_api_key}
              onChange={e => setEditSettings(p => ({ ...p, nvidia_api_key: e.target.value }))} />
            <SettingField label="Apify Token" type="password"
              value={editSettings.apify_token}
              onChange={e => setEditSettings(p => ({ ...p, apify_token: e.target.value }))} />
            <SettingField label="App Password" type="password"
              value={editSettings.app_password}
              onChange={e => setEditSettings(p => ({ ...p, app_password: e.target.value }))} />
            <button onClick={handleSaveSettings} style={{ ...btnStyle, background: 'var(--accent-primary)', color: '#fff', marginTop: 4, justifyContent: 'center', width: '100%' }}>
              <CheckCircle size={14} /> Save Settings
            </button>
          </div>
          {loading.settings && <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
        </div>
      )}

      {/* ═══ CONTENT TAB ═══ */}
      {activeTab === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 14 : 20 }}>
          {/* Ingest trigger */}
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 14 : 20, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Trigger Ingest</div>
            <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: mobile ? 8 : 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>User ID</label>
                <input value={ingestUser} onChange={e => setIngestUser(e.target.value)}
                  placeholder="e.g. alpha" style={inputStyle} />
              </div>
              <button onClick={handleIngest} disabled={ingesting}
                style={{ ...btnStyle, background: ingesting ? '#7c3aed' : 'var(--accent-primary)', color: '#fff', opacity: ingesting ? 0.7 : 1, justifyContent: 'center', width: mobile ? '100%' : 'auto', marginTop: mobile ? 0 : 'auto' }}>
                <Play size={14} /> {ingesting ? 'Processing...' : 'Ingest Queue'}
              </button>
            </div>
            {ingestLogs && (
              <div style={{ marginTop: 10, background: '#0f172a', borderRadius: 8, padding: mobile ? 10 : 12, fontFamily: 'monospace', fontSize: mobile ? 11 : 12, color: '#10b981', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {ingestLogs}
              </div>
            )}
          </div>

          {/* Global queue */}
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 14 : 20, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Queue ({queue.length})</div>
            {queue.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No pending items.</div>}
            <div style={{ maxHeight: 250, overflow: 'auto' }}>
              {queue.map(q => (
                <div key={q.id || q.url} style={{
                  padding: '8px 0', borderBottom: '1px solid var(--border-color)', fontSize: 13,
                  display: 'flex', justifyContent: 'space-between', alignItems: mobile ? 'start' : 'center',
                  flexDirection: mobile ? 'column' : 'row', gap: mobile ? 4 : 0
                }}>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontWeight: 500 }}>{q.user_id || '-'}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11, wordBreak: 'break-all' }}>{q.url}</span>
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, flexShrink: 0,
                    background: q.status === 'pending' ? '#fef3c7' : '#ecfdf5',
                    color: q.status === 'pending' ? '#92400e' : '#065f46' }}>
                    {q.status}
                  </span>
                </div>
              ))}
            </div>
            {loading.queue && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
          </div>

          {/* Global notes */}
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: mobile ? 14 : 20, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: mobile ? 'stretch' : 'center', marginBottom: 12, gap: mobile ? 8 : 10 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Notes ({notes.total ?? 0})</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={notesFilter} onChange={e => { setNotesFilter(e.target.value); setNotesPage(1); loadNotes(1, e.target.value); }}
                  placeholder="Filter user" style={{ ...inputStyle, width: mobile ? 120 : 160, padding: '6px 10px', fontSize: 12 }} />
                <button onClick={() => { setNotesPage(1); loadNotes(1, notesFilter); }}
                  style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', flexShrink: 0 }}>
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            {loading.notes && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
            {!loading.notes && (notes.notes || []).map(n => (
              <div key={n.id} style={{ padding: mobile ? '10px 0' : '10px 12px', borderBottom: '1px solid var(--border-color)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{n.title}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: mobile ? 11 : 12, marginTop: 2 }}>
                      <span style={{ marginRight: 8 }}>{n.user_id}</span>
                      {(n.tags || []).slice(0, 2).map(t => (
                        <span key={t} style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 10, background: '#ede9fe', color: '#6d28d9', marginRight: 3 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteNote(n.id)}
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #fecaca', background: 'none', cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {notes.total > 50 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
                <button onClick={() => { setNotesPage(p => Math.max(1, p - 1)); loadNotes(Math.max(1, notesPage - 1), notesFilter); }}
                  disabled={notesPage <= 1} style={{ ...btnStyle, opacity: notesPage <= 1 ? 0.5 : 1 }}>Prev</button>
                <span style={{ fontSize: 13, alignSelf: 'center' }}>{notes.page}/{Math.ceil(notes.total / 50)}</span>
                <button onClick={() => { setNotesPage(p => p + 1); loadNotes(notesPage + 1, notesFilter); }}
                  disabled={notesPage >= Math.ceil(notes.total / 50)} style={{ ...btnStyle, opacity: notesPage >= Math.ceil(notes.total / 50) ? 0.5 : 1 }}>Next</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ AUDIT TAB ═══ */}
      {activeTab === 'audit' && (
        <div style={{ background: '#0f172a', borderRadius: 12, padding: mobile ? 14 : 20, fontFamily: 'monospace', fontSize: mobile ? 11 : 13, maxHeight: 600, overflow: 'auto' }}>
          <div style={{ color: '#94a3b8', marginBottom: 12, fontWeight: 600 }}>Recent Admin Actions</div>
          {loading.audit && <div style={{ color: '#64748b' }}>Loading...</div>}
          {(auditLog || []).map(a => (
            <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #1e293b', wordBreak: 'break-word' }}>
              <span style={{ color: '#64748b', display: 'block', marginBottom: 2 }}>{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</span>
              <span style={{ color: '#10b981' }}>{a.action}</span>
              <span style={{ color: '#94a3b8', marginLeft: 6 }}>{a.detail}</span>
              <span style={{ color: '#64748b', marginLeft: 6 }}>({a.actor})</span>
            </div>
          ))}
          {auditLog.length === 0 && !loading.audit && <div style={{ color: '#64748b' }}>No audit entries yet.</div>}
        </div>
      )}
    </div>
  );
}

// ── Reusable sub-components ──

function SettingField({ label, type, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={onChange} style={inputStyle} placeholder={type === 'password' ? '••••••••' : ''} />
    </div>
  );
}

// ── Shared styles ──
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-color)',
  background: 'var(--bg-deep)', fontSize: 14, color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box'
};

const btnStyle = {
  padding: '10px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13
};

const thStyle = { padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const tdStyle = { padding: '10px 12px' };
