import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, BarChart3, Settings, FileText, Shield,
  Trash2, Play, Plus, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, ChevronLeft, ChevronRight, Eye, EyeOff, LogOut, Search, Sliders
} from 'lucide-react';

const ADMIN_HEADERS = { 'x-admin-password': '', 'Content-Type': 'application/json' };

function useWindowSize() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

export default function AdminView({ adminPassword, apiUrl, onLogout }) {
  const width = useWindowSize();
  const isMobile = width < 640;
  const isTablet = width < 1024;

  const [activeTab, setActiveTab] = useState('stats');
  const [contentSubTab, setContentSubTab] = useState('notes');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [notes, setNotes] = useState([]);
  const [queue, setQueue] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState('');

  // Form states
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ user_id: '', display_name: '', monthly_limit: '20', password: '' });
  const [editSettings, setEditSettings] = useState({ global_monthly_limit: '', gemini_api_key: '', nvidia_api_key: '', apify_token: '', app_password: '' });
  const [showSettingsPasswords, setShowSettingsPasswords] = useState({});
  const [notesPage, setNotesPage] = useState(1);
  const [notesFilter, setNotesFilter] = useState('');
  const [ingestLogs, setIngestLogs] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestUser, setIngestUser] = useState('');

  const headers = { ...ADMIN_HEADERS, 'x-admin-password': adminPassword };

  const adminFetch = useCallback(async (path, options = {}) => {
    const res = await fetch(`${apiUrl}/api/admin${path}`, { headers, ...options });
    if (res.status === 401) throw new Error('Invalid admin password');
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  }, [adminPassword, apiUrl]);

  // ── Data loaders ──
  const loadStats = useCallback(async () => { setLoading(p => ({ ...p, stats: true })); try { setStats(await adminFetch('/stats')); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, stats: false })); }, [adminFetch]);
  const loadUsers = useCallback(async () => { setLoading(p => ({ ...p, users: true })); try { setUsers(await adminFetch('/users')); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, users: false })); }, [adminFetch]);
  const loadSettings = useCallback(async () => { setLoading(p => ({ ...p, settings: true })); try { const s = await adminFetch('/settings'); setSettings(s); setEditSettings({ global_monthly_limit: s.global_monthly_limit || '', gemini_api_key: s.gemini_api_key || '', nvidia_api_key: s.nvidia_api_key || '', apify_token: s.apify_token || '', app_password: s.app_password || '' }); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, settings: false })); }, [adminFetch]);
  const loadNotes = useCallback(async (page = 1, userId = '') => { setLoading(p => ({ ...p, notes: true })); try { const params = new URLSearchParams({ page: String(page), limit: '50' }); if (userId) params.set('user_id', userId); const data = await adminFetch(`/notes?${params}`); setNotes(data); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, notes: false })); }, [adminFetch]);
  const loadQueue = useCallback(async () => { setLoading(p => ({ ...p, queue: true })); try { setQueue(await adminFetch('/queue')); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, queue: false })); }, [adminFetch]);
  const loadAudit = useCallback(async () => { setLoading(p => ({ ...p, audit: true })); try { setAuditLog(await adminFetch('/audit?limit=100')); setError(''); } catch (e) { setError(e.message); } setLoading(p => ({ ...p, audit: false })); }, [adminFetch]);

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
    try { await adminFetch('/users', { method: 'POST', body: JSON.stringify(newUser) }); setNewUser({ user_id: '', display_name: '', monthly_limit: '20', password: '' }); setShowCreateUser(false); loadUsers(); loadStats(); } catch (e) { setError(e.message); }
  };
  const handleToggleDisable = async (userId, isDisabled) => {
    try { await adminFetch(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ is_disabled: !isDisabled }) }); loadUsers(); } catch (e) { setError(e.message); }
  };
  const handleUpdateUserLimit = async (userId, val) => {
    try { await adminFetch(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ monthly_limit: parseInt(val, 10) }) }); loadUsers(); } catch (e) { setError(e.message); }
  };
  const handleDeleteNote = async (noteId) => {
    if (!confirm(`Delete note ${noteId}?`)) return;
    try { await adminFetch(`/notes/${noteId}`, { method: 'DELETE' }); loadNotes(notesPage, notesFilter); loadStats(); } catch (e) { setError(e.message); }
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
      setError(''); alert('Settings saved.'); loadSettings();
    } catch (e) { setError(e.message); }
  };
  const handleIngest = async () => {
    if (!ingestUser) return;
    setIngesting(true); setIngestLogs('Starting ingestion...\n');
    try {
      const res = await fetch(`${apiUrl}/api/admin/ingest`, { method: 'POST', headers, body: JSON.stringify({ user_id: ingestUser }) });
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); setIngestLogs(buffer); }
    } catch (e) { setIngestLogs(prev => prev + `\nError: ${e.message}`); }
    setIngesting(false);
  };

  // ── Navigation items ──
  const navItems = [
    { key: 'stats', label: 'Stats', icon: <BarChart3 size={20} /> },
    { key: 'users', label: 'Users', icon: <Users size={20} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={20} /> },
    { key: 'content', label: 'Content', icon: <FileText size={20} /> },
    { key: 'audit', label: 'Audit', icon: <Shield size={20} /> },
  ];

  // ── Render ──
  return (
    <div style={{ display: 'flex', height: isMobile ? 'auto' : '100vh', background: 'var(--bg-deep)' }}>
      {/* ═══ SIDEBAR / BOTTOM TABS ═══ */}
      {!isMobile ? (
        <aside style={{
          width: isTablet ? 64 : 220, background: '#0f172a', color: '#94a3b8',
          display: 'flex', flexDirection: 'column', flexShrink: 0,
          transition: 'width 0.2s ease'
        }}>
          {/* Logo */}
          <div style={{ padding: isTablet ? '16px 12px' : '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sliders size={16} color="#fff" />
            </div>
            {!isTablet && <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'Outfit' }}>TreeMind</div><div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>Admin Panel</div></div>}
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: '8px 0' }}>
            {navItems.map(item => (
              <button key={item.key} onClick={() => setActiveTab(item.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: isTablet ? 0 : 12,
                  padding: isTablet ? '12px 0' : '10px 20px', width: '100%', border: 'none',
                  background: activeTab === item.key ? 'rgba(14,165,233,0.1)' : 'transparent',
                  color: activeTab === item.key ? '#38bdf8' : '#94a3b8',
                  cursor: 'pointer', fontSize: 14, fontWeight: activeTab === item.key ? 600 : 400,
                  transition: 'all 0.15s ease', borderLeft: activeTab === item.key ? '3px solid #38bdf8' : '3px solid transparent',
                  justifyContent: isTablet ? 'center' : 'flex-start'
                }}>
                {item.icon}
                {!isTablet && <span>{item.label}</span>}
              </button>
            ))}
          </nav>

          {/* Logout */}
          <div style={{ padding: '12px 0', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
            <button onClick={onLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: isTablet ? 0 : 10,
                padding: isTablet ? '12px 0' : '10px 20px', width: '100%', border: 'none',
                background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 13,
                justifyContent: isTablet ? 'center' : 'flex-start', transition: 'color 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              <LogOut size={18} />
              {!isTablet && <span>Back to Login</span>}
            </button>
          </div>
        </aside>
      ) : (
        /* Mobile: bottom tab bar */
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, height: 60,
          background: '#0f172a', display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          zIndex: 100, borderTop: '1px solid rgba(148,163,184,0.1)',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setActiveTab(item.key)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                border: 'none', background: 'none', cursor: 'pointer',
                color: activeTab === item.key ? '#38bdf8' : '#64748b',
                fontSize: 10, fontWeight: activeTab === item.key ? 600 : 400,
                padding: '6px 4px', transition: 'color 0.15s'
              }}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* ═══ MAIN CONTENT AREA ═══ */}
      <main style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px 16px 76px 16px' : '24px 32px', minWidth: 0 }}>
        {/* Mobile header */}
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sliders size={14} color="#fff" />
              </div>
              <span style={{ fontWeight: 700, fontSize: 16, fontFamily: 'Outfit' }}>TreeMind Admin</span>
            </div>
            <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12 }}>
              <LogOut size={14} /> Exit
            </button>
          </div>
        )}

        {/* Desktop header */}
        {!isMobile && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <h1 style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
                {navItems.find(n => n.key === activeTab)?.label || 'Dashboard'}
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>Manage your TreeMind application</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--bg-base)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Admin</span>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}><XCircle size={16} /></button>
          </div>
        )}

        <div style={{ maxWidth: isMobile ? '100%' : 1100, margin: '0 auto' }}>
          {/* ═══ STATS TAB ═══ */}
          {activeTab === 'stats' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: isMobile ? 10 : 16 }}>
                {[
                  { label: 'Total Users', value: stats?.userCount ?? '-', color: '#0ea5e9', icon: <Users size={22} /> },
                  { label: 'Total Notes', value: stats?.totalNotes ?? '-', color: '#8b5cf6', icon: <FileText size={22} /> },
                  { label: 'This Month', value: stats?.monthNotes ?? '-', color: '#10b981', icon: <BarChart3 size={22} /> },
                  { label: 'In Queue', value: stats?.pendingQueue ?? '-', color: '#f59e0b', icon: <RefreshCw size={22} /> },
                ].map((card, i) => (
                  <div key={i} className="admin-stat-card" style={{
                    background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20,
                    boxShadow: 'var(--shadow-sm)', borderLeft: `4px solid ${card.color}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: isMobile ? 11 : 12, marginBottom: 4, fontWeight: 500 }}>{card.label}</div>
                      <div style={{ fontSize: isMobile ? 28 : 36, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
                    </div>
                    <div style={{ color: card.color, opacity: 0.3 }}>{card.icon}</div>
                  </div>
                ))}
              </div>
              {/* Per-user usage */}
              {stats?.perUserCounts && Object.keys(stats.perUserCounts).length > 0 && (
                <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20, boxShadow: 'var(--shadow-sm)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Usage by User</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.entries(stats.perUserCounts).sort((a, b) => b[1] - a[1]).map(([uid, count]) => {
                      const max = Math.max(...Object.values(stats.perUserCounts));
                      const pct = Math.round((count / max) * 100);
                      return (
                        <div key={uid}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{uid}</span>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{count} notes</span>
                          </div>
                          <div style={{ width: '100%', height: 6, background: 'var(--bg-base)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', borderRadius: 3, transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ USERS TAB ═══ */}
          {activeTab === 'users' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Create user toggle */}
              <button onClick={() => setShowCreateUser(!showCreateUser)}
                className="action-btn" style={{ width: isMobile ? '100%' : 'auto', gap: 8 }}>
                {showCreateUser ? <ChevronRight size={14} /> : <Plus size={14} />}
                {showCreateUser ? 'Cancel' : 'Create New User'}
              </button>

              {/* Create user form */}
              {showCreateUser && (
                <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--accent-primary)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>New User</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>User ID *</label>
                      <input value={newUser.user_id} onChange={e => setNewUser(p => ({ ...p, user_id: e.target.value }))} placeholder="e.g. user_42" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Display Name</label>
                      <input value={newUser.display_name} onChange={e => setNewUser(p => ({ ...p, display_name: e.target.value }))} placeholder="e.g. John" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Password</label>
                      <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="Leave blank to use app default" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Monthly Limit</label>
                      <input type="number" value={newUser.monthly_limit} onChange={e => setNewUser(p => ({ ...p, monthly_limit: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <button onClick={handleCreateUser} style={{ ...btnPrimary, width: isMobile ? '100%' : 'auto', justifyContent: 'center' }}>
                    <CheckCircle size={14} /> Create User
                  </button>
                </div>
              )}

              {/* User cards */}
              {(users || []).map(u => (
                <div key={u.user_id} className="admin-card" style={{
                  background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 14 : 18,
                  boxShadow: 'var(--shadow-sm)', border: u.is_disabled ? '1px solid #fecaca' : '1px solid var(--border-color)',
                  opacity: u.is_disabled ? 0.6 : 1
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: 15 }}>{u.display_name || u.user_id}</strong>
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: u.is_disabled ? '#fef2f2' : '#ecfdf5', color: u.is_disabled ? '#dc2626' : '#059669' }}>
                          {u.is_disabled ? 'Disabled' : 'Active'}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>ID: {u.user_id}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: u.has_password ? '#dbeafe' : '#f1f5f9',
                          color: u.has_password ? '#1d4ed8' : 'var(--text-muted)' }}>
                          {u.has_password ? '🔑 Own password' : '🔑 Uses app default'}
                        </span>
                      </div>
                      {/* Usage bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, maxWidth: 200 }}>
                          <div style={{ width: '100%', height: 6, background: 'var(--bg-base)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (u.monthNoteCount / Math.max(1, u.monthly_limit)) * 100)}%`, height: '100%',
                              background: u.monthNoteCount >= u.monthly_limit ? '#ef4444' : 'var(--accent-primary)', borderRadius: 3, transition: 'width 0.3s' }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{u.monthNoteCount} / {u.monthly_limit}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'end', gap: 8, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        <span>Limit:</span>
                        <input type="number" value={u.monthly_limit} onChange={e => handleUpdateUserLimit(u.user_id, e.target.value)}
                          style={{ width: 50, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border-color)', fontSize: 13, textAlign: 'center', background: 'var(--bg-base)' }} />
                      </div>
                      <button onClick={() => {
                        const pwd = prompt(`Set password for ${u.user_id} (leave blank to remove custom password):`);
                        if (pwd !== null) handleUpdateUserLimit(u.user_id, u.monthly_limit); // dummy await
                        // Send PATCH with password
                        adminFetch(`/users/${u.user_id}`, { method: 'PATCH', body: JSON.stringify({ password: pwd }) })
                          .then(() => loadUsers())
                          .catch(e => setError(e.message));
                      }}
                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--accent-primary)' }}>
                        Set Password
                      </button>
                      <button onClick={() => handleToggleDisable(u.user_id, u.is_disabled)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          color: u.is_disabled ? '#059669' : '#dc2626' }}>
                        {u.is_disabled ? 'Enable' : 'Disable'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {loading.users && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading...</div>}
            </div>
          )}

          {/* ═══ SETTINGS TAB ═══ */}
          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
              {/* Usage Limits */}
              <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20, boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Usage Limits</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Control the default monthly extraction limit for all users.</p>
                <div>
                  <label style={labelStyle}>Global Monthly Limit</label>
                  <input type="number" value={editSettings.global_monthly_limit} onChange={e => setEditSettings(p => ({ ...p, global_monthly_limit: e.target.value }))}
                    placeholder="20" style={inputStyle} />
                </div>
              </div>

              {/* API Configuration */}
              <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20, boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>API Configuration</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>API keys are stored securely in the database.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { key: 'gemini_api_key', label: 'Gemini API Key', desc: 'Google Gemini for text generation' },
                    { key: 'nvidia_api_key', label: 'NVIDIA API Key', desc: 'NVIDIA NIM for LLM inference' },
                    { key: 'apify_token', label: 'Apify Token', desc: 'Apify for web scraping' },
                  ].map(field => (
                    <div key={field.key}>
                      <label style={labelStyle}>{field.label}</label>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px 0' }}>{field.desc}</p>
                      <div style={{ position: 'relative' }}>
                        <input type={showSettingsPasswords[field.key] ? 'text' : 'password'}
                          value={editSettings[field.key]} onChange={e => setEditSettings(p => ({ ...p, [field.key]: e.target.value }))}
                          placeholder="Leave blank to keep current" style={{ ...inputStyle, paddingRight: 40 }} />
                        <button type="button" onClick={() => setShowSettingsPasswords(p => ({ ...p, [field.key]: !p[field.key] }))}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                          {showSettingsPasswords[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Authentication */}
              <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 16 : 20, boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Authentication</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Change the main app password that users use to log in.</p>
                <div style={{ position: 'relative' }}>
                  <label style={labelStyle}>App Password</label>
                  <input type={showSettingsPasswords.app_password ? 'text' : 'password'}
                    value={editSettings.app_password} onChange={e => setEditSettings(p => ({ ...p, app_password: e.target.value }))}
                    placeholder="Leave blank to keep current" style={{ ...inputStyle, paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowSettingsPasswords(p => ({ ...p, app_password: !p.app_password }))}
                    style={{ position: 'absolute', right: 8, bottom: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                    {showSettingsPasswords.app_password ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button onClick={handleSaveSettings} style={{ ...btnPrimary, width: '100%', justifyContent: 'center', marginTop: 4 }}>
                <CheckCircle size={14} /> Save All Settings
              </button>
              {loading.settings && <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading...</div>}
            </div>
          )}

          {/* ═══ CONTENT TAB ═══ */}
          {activeTab === 'content' && (
            <div>
              {/* Sub-tabs */}
              <div className="admin-sub-tabs" style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border-color)' }}>
                {[
                  { key: 'ingest', label: 'Ingest', icon: <Play size={14} /> },
                  { key: 'queue', label: `Queue (${queue.length || 0})`, icon: <RefreshCw size={14} /> },
                  { key: 'notes', label: `Notes (${notes.total ?? 0})`, icon: <FileText size={14} /> },
                ].map(st => (
                  <button key={st.key} onClick={() => setContentSubTab(st.key)}
                    style={{
                      padding: '10px 16px', border: 'none', background: 'none',
                      color: contentSubTab === st.key ? 'var(--accent-primary)' : 'var(--text-muted)',
                      fontWeight: contentSubTab === st.key ? 600 : 400, fontSize: 13,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                      borderBottom: contentSubTab === st.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
                      marginBottom: '-2px', transition: 'all 0.15s'
                    }}>
                    {st.icon} {st.label}
                  </button>
                ))}
              </div>

              {/* Ingest sub-tab */}
              {contentSubTab === 'ingest' && (
                <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: isMobile ? 14 : 20, boxShadow: 'var(--shadow-sm)' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Trigger Ingest</h3>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <input value={ingestUser} onChange={e => setIngestUser(e.target.value)} placeholder="User ID (e.g. alpha)" style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={handleIngest} disabled={ingesting} style={{ ...btnPrimary, whiteSpace: 'nowrap', opacity: ingesting ? 0.6 : 1 }}>
                      <Play size={14} /> {ingesting ? 'Running...' : 'Start'}
                    </button>
                  </div>
                  {ingestLogs && (
                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, color: '#10b981', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6 }}>
                      {ingestLogs}
                    </div>
                  )}
                </div>
              )}

              {/* Queue sub-tab */}
              {contentSubTab === 'queue' && (
                <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', maxHeight: '70vh', overflow: 'auto' }}>
                  {queue.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No items in queue.</div>}
                  {queue.map((q, i) => (
                    <div key={q.id || q.url || i} style={{
                      padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, gap: 8
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{q.user_id || '-'}</span>
                          <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                            background: q.status === 'pending' ? '#fef3c7' : '#ecfdf5', color: q.status === 'pending' ? '#92400e' : '#065f46' }}>
                            {q.status}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.url}</div>
                      </div>
                    </div>
                  ))}
                  {loading.queue && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
                </div>
              )}

              {/* Notes sub-tab */}
              {contentSubTab === 'notes' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Search bar */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input value={notesFilter} onChange={e => { setNotesFilter(e.target.value); setNotesPage(1); loadNotes(1, e.target.value); }}
                        placeholder="Filter by user ID..." style={{ ...inputStyle, paddingLeft: 36 }} />
                    </div>
                    <button onClick={() => { setNotesPage(1); loadNotes(1, notesFilter); }}
                      style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', cursor: 'pointer', flexShrink: 0 }}>
                      <RefreshCw size={16} />
                    </button>
                  </div>

                  {/* Notes list with scroll */}
                  <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', maxHeight: '65vh', overflow: 'auto' }}>
                    {loading.notes && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
                    {!loading.notes && (notes.notes || []).map(n => (
                      <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, wordBreak: 'break-word' }}>{n.title}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                            <span style={{ fontWeight: 500 }}>{n.user_id}</span>
                            <span>•</span>
                            <span>{n.dateProcessed}</span>
                            {(n.tags || []).slice(0, 2).map(t => (
                              <span key={t} style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, background: '#ede9fe', color: '#6d28d9' }}>{t}</span>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteNote(n.id)}
                          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #fecaca', background: 'none', cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {!loading.notes && (!notes.notes || notes.notes.length === 0) && (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No notes found.</div>
                    )}
                  </div>

                  {/* Pagination */}
                  {notes.total > 50 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center' }}>
                      <button onClick={() => { setNotesPage(p => Math.max(1, p - 1)); loadNotes(Math.max(1, notesPage - 1), notesFilter); }}
                        disabled={notesPage <= 1} style={{ ...btnSecondary, opacity: notesPage <= 1 ? 0.4 : 1 }}>← Prev</button>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {notes.page} of {Math.ceil(notes.total / 50)}</span>
                      <button onClick={() => { setNotesPage(p => p + 1); loadNotes(notesPage + 1, notesFilter); }}
                        disabled={notesPage >= Math.ceil(notes.total / 50)} style={{ ...btnSecondary, opacity: notesPage >= Math.ceil(notes.total / 50) ? 0.4 : 1 }}>Next →</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ AUDIT TAB ═══ */}
          {activeTab === 'audit' && (
            <div>
              <div className="admin-card" style={{ background: 'var(--bg-elevated)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', maxHeight: '70vh', overflow: 'auto' }}>
                {auditLog.length === 0 && !loading.audit && (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    <Shield size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
                    <div>No admin actions recorded yet.</div>
                  </div>
                )}
                {auditLog.map((a, i) => (
                  <div key={a.id || i} style={{
                    padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
                    background: i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-base)',
                    fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center'
                  }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: isMobile ? 140 : 180 }}>{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46' }}>{a.action}</span>
                    <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{a.detail}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({a.actor})</span>
                  </div>
                ))}
                {loading.audit && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Shared styles ──
const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-deep)', fontSize: 14, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' };
const btnPrimary = { padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, background: 'var(--accent-primary)', color: '#fff' };
const btnSecondary = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' };
