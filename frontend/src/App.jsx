import React, { useState, useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import { 
  Folder, 
  FolderOpen, 
  Search, 
  Plus, 
  Play, 
  Clock, 
  Settings, 
  Lock, 
  X, 
  Terminal, 
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Sliders,
  CheckCircle,
  FileText,
  Edit2
} from 'lucide-react';

const API_BASE = ''; // Proxy-less since Vite serves from same domain in production, but we fallback to port 5000 in dev
// Capacitor Android: app runs from local assets, needs explicit backend URL
// Users set their server IP in Settings; stored in localStorage as 'treemind_server_url'
const isCapacitor = window.Capacitor !== undefined;

export default function App() {
  // Authentication State
  const [password, setPassword] = useState(() => localStorage.getItem('tm_password') || '');
  const [userId, setUserId] = useState(() => localStorage.getItem('tm_user_id') || 'default');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [userIdInput, setUserIdInput] = useState(() => localStorage.getItem('tm_user_id') || '');

  // App Data State
  const [notes, setNotes] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(null); // { root: string, sub: string | null }
  const [expandedCategories, setExpandedCategories] = useState({}); // { [root]: boolean }
  const [searchQuery, setSearchQuery] = useState('');
  
  // URL Input State
  const [newUrl, setNewUrl] = useState('');
  const [depth, setDepth] = useState('Detailed Notes');

  // Modal State
  const [selectedNote, setSelectedNote] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [loadingNote, setLoadingNote] = useState(false);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [nvidiaKey, setNvidiaKey] = useState('');
  const [apifyToken, setApifyToken] = useState('');
  const [newAppPassword, setNewAppPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('treemind_server_url') || '');
  const API_URL = useMemo(() => {
    if (serverUrl) return serverUrl.replace(/\/$/, '');
    if (isCapacitor) return '';
    return window.location.port === '5173' ? 'http://localhost:5000' : '';
  }, [serverUrl]);
  const [settingsStatus, setSettingsStatus] = useState('');

  // Logs & Ingestion Console State
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);

  // Metadata Editor State
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [editCategorySelect, setEditCategorySelect] = useState('');
  const [newMainCategory, setNewMainCategory] = useState('');
  const [newSubCategory, setNewSubCategory] = useState('');
  const [editTagsInput, setEditTagsInput] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Authenticate on mount or password change
  useEffect(() => {
    if (password) {
      verifyPassword(password, userId);
    } else {
      setLoading(false);
    }
  }, [password]);

  const verifyPassword = async (pass, usrId = userId) => {
    if (isCapacitor && !API_URL) {
      setLoginError('Please configure your Server URL using the button below.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': usrId
        },
        body: JSON.stringify({ password: pass })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setPassword(pass);
        setUserId(usrId);
        localStorage.setItem('tm_password', pass);
        localStorage.setItem('tm_user_id', usrId);
        fetchData(pass, usrId);
      } else {
        setLoginError('Invalid application password.');
        setIsAuthenticated(false);
        setLoading(false);
      }
    } catch (e) {
      setLoginError('Could not connect to local server: ' + e.message);
      setLoading(false);
    }
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    verifyPassword(passwordInput, userIdInput || 'default');
  };

  const handleLogout = () => {
    localStorage.removeItem('tm_password');
    setPassword('');
    setIsAuthenticated(false);
  };

  // Fetch Notes & Queue
  const fetchData = async (pass = password, usrId = userId) => {
    setLoading(true);
    try {
      const headers = { 
        'x-app-password': pass,
        'x-user-id': usrId
      };
      
      const [notesRes, queueRes] = await Promise.all([
        fetch(`${API_URL}/api/tree`, { headers }),
        fetch(`${API_URL}/api/queue`, { headers })
      ]);

      if (notesRes.ok) {
        const notesData = await notesRes.json();
        setNotes(notesData);
      }
      if (queueRes.ok) {
        const queueData = await queueRes.json();
        setQueue(queueData);
      }
    } catch (e) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  };

  // Load specific note content
  const loadNoteContent = async (note) => {
    setLoadingNote(true);
    setSelectedNote(note);
    setNoteContent('');
    
    // Initialize metadata editor states
    setIsEditingMeta(false);
    setEditCategorySelect(note.categoryPath ? note.categoryPath.join(' / ') : 'General');
    setEditTagsInput(note.tags ? note.tags.join(', ') : '');
    setNewMainCategory('');
    setNewSubCategory('');

    try {
      const cleanPath = note.filePath.replace('vault/', '');
      const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, '/');
      const res = await fetch(`${API_URL}/api/vault/${encodedPath}`, {
        headers: { 
          'x-app-password': password,
          'x-user-id': userId
        }
      });
      if (res.ok) {
        const text = await res.text();
        // Remove yaml frontmatter for rendering
        const cleaned = text.replace(/^---[\s\S]*?---\n*/, '');
        setNoteContent(cleaned);
      } else {
        setNoteContent('Failed to load note content.');
      }
    } catch (e) {
      setNoteContent('Error reading note file: ' + e.message);
    } finally {
      setLoadingNote(false);
    }
  };

  // Add URL to Queue
  const handleAddToQueue = async (e) => {
    e.preventDefault();
    if (!newUrl) return;

    try {
      const res = await fetch(`${API_URL}/api/queue`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId
        },
        body: JSON.stringify({ url: newUrl, depth })
      });

      if (res.ok) {
        setNewUrl('');
        fetchData();
        // Open console automatically to encourage sync
        setShowConsole(true);
        setConsoleLogs(prev => prev + `[System] Queued URL: ${newUrl} with depth: ${depth}\n`);
      } else {
        alert('Failed to queue URL');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // Trigger Queue Ingestion
  const triggerIngestion = async () => {
    setIsIngesting(true);
    setShowConsole(true);
    setConsoleLogs(prev => prev + `[Ingest] Launching pipeline ingestion...\n`);
    try {
      const res = await fetch(`${API_URL}/api/ingest`, {
        method: 'POST',
        headers: { 
          'x-app-password': password,
          'x-user-id': userId
        }
      });
      const data = await res.json();
      
      if (data.success) {
        setConsoleLogs(prev => prev + `[Success] Ingestion finished successfully.\n${data.stdout}\n`);
        fetchData();
      } else {
        setConsoleLogs(prev => prev + `[Error] Ingestion failed:\n${data.error}\n${data.stderr}\n`);
      }
    } catch (e) {
      setConsoleLogs(prev => prev + `[Error] Connection error: ${e.message}\n`);
    } finally {
      setIsIngesting(false);
    }
  };

  // Update Settings/API Keys
  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setSettingsStatus('');
    
    // 1. Clean and save Server URL to localStorage
    let cleanedUrl = serverUrl ? serverUrl.trim().replace(/\/$/, '') : '';
    if (cleanedUrl && !/^https?:\/\//i.test(cleanedUrl)) {
      cleanedUrl = 'http://' + cleanedUrl;
    }
    const oldUrl = localStorage.getItem('treemind_server_url') || '';
    
    if (cleanedUrl) {
      localStorage.setItem('treemind_server_url', cleanedUrl);
    } else {
      localStorage.removeItem('treemind_server_url');
    }
    setServerUrl(cleanedUrl);

    // 2. If authenticated, try to save API keys to backend
    let backendSaved = false;
    if (isAuthenticated && (cleanedUrl || API_URL)) {
      try {
        const targetUrl = cleanedUrl || API_URL;
        const res = await fetch(`${targetUrl}/api/settings`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-app-password': password
          },
          body: JSON.stringify({
            geminiApiKey: geminiKey || undefined,
            nvidiaApiKey: nvidiaKey || undefined,
            apifyToken: apifyToken || undefined,
            appPassword: newAppPassword || undefined
          })
        });

        if (res.ok) {
          backendSaved = true;
          if (newAppPassword) {
            setPassword(newAppPassword);
          }
        }
      } catch (err) {
        console.error('Failed to save backend settings:', err);
      }
    }

    setSettingsStatus('Settings saved successfully!');

    // 3. Reload only if the Server URL changed (important for applying new API base URL)
    if (cleanedUrl !== oldUrl) {
      setSettingsStatus('Server URL changed. Reloading app...');
      setTimeout(() => window.location.reload(), 500);
    } else {
      setTimeout(() => {
        setShowSettings(false);
        setSettingsStatus('');
        fetchData();
      }, 1500);
    }
  };

  // Helper to extract nested categories
  const categoriesMap = useMemo(() => {
    const map = {};
    notes.forEach(note => {
      const path = note.categoryPath || ['General'];
      const root = path[0] || 'General';
      const sub = path[1] || null;
      if (!map[root]) {
        map[root] = new Set();
      }
      if (sub) {
        map[root].add(sub);
      }
    });
    return map;
  }, [notes]);

  // Get list of unique existing category paths in tree.json
  const existingCategoryPaths = useMemo(() => {
    const paths = new Set();
    notes.forEach(note => {
      if (note.categoryPath && note.categoryPath.length > 0) {
        paths.add(note.categoryPath.join(' / '));
      }
    });
    return Array.from(paths);
  }, [notes]);

  const handleSaveMetadata = async () => {
    if (!selectedNote) return;
    setSavingMeta(true);
    
    let path = [];
    if (editCategorySelect === 'NEW_CATEGORY') {
      const main = newMainCategory.trim();
      const sub = newSubCategory.trim();
      if (!main) {
        alert('Please specify at least a Main Category name.');
        setSavingMeta(false);
        return;
      }
      path = sub ? [main, sub] : [main];
    } else {
      path = editCategorySelect.split(' / ').map(p => p.trim());
    }

    const tags = editTagsInput.split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    try {
      const res = await fetch(`${API_URL}/api/note/update-metadata`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId
        },
        body: JSON.stringify({
          id: selectedNote.id,
          categoryPath: path,
          tags: tags
        })
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          setSelectedNote(result.note);
          setIsEditingMeta(false);
          await fetchData();
        } else {
          alert('Failed to update metadata.');
        }
      } else {
        const errorData = await res.json();
        alert('Error updating note: ' + (errorData.error || res.statusText));
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    } finally {
      setSavingMeta(false);
    }
  };

  const handleRenameCategory = async (oldPath) => {
    const oldPathStr = oldPath.join(' / ');
    const newName = prompt(`Rename category "${oldPathStr}" to:`, oldPath[oldPath.length - 1]);
    
    if (newName === null) return; // user cancelled
    const trimmed = newName.trim();
    if (!trimmed) {
      alert('Category name cannot be empty.');
      return;
    }
    if (trimmed === oldPath[oldPath.length - 1]) return; // no change

    const newPath = [...oldPath];
    newPath[newPath.length - 1] = trimmed;

    try {
      const res = await fetch(`${API_URL}/api/category/rename`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId
        },
        body: JSON.stringify({ oldPath, newPath })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (activeCategory && activeCategory.root === oldPath[0]) {
            if (oldPath.length === 1) {
              setActiveCategory({ root: trimmed, sub: activeCategory.sub });
            } else if (oldPath.length === 2 && activeCategory.sub === oldPath[1]) {
              setActiveCategory({ root: activeCategory.root, sub: trimmed });
            }
          }
          await fetchData();
        } else {
          alert('Failed to rename category.');
        }
      } else {
        const err = await res.json();
        alert('Error: ' + (err.error || res.statusText));
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    }
  };

  const toggleCategoryExpand = (root) => {
    setExpandedCategories(prev => ({
      ...prev,
      [root]: !prev[root]
    }));
  };

  // Fuzzy Search Index with Fuse.js
  const fuse = useMemo(() => {
    return new Fuse(notes, {
      keys: ['title', 'tags', 'snippet'],
      threshold: 0.3
    });
  }, [notes]);

  // Filter & Search
  const filteredNotes = useMemo(() => {
    let list = notes;

    // Apply category filter
    if (activeCategory) {
      list = list.filter(note => {
        const path = note.categoryPath || ['General'];
        if (activeCategory.sub) {
          return path[0] === activeCategory.root && path[1] === activeCategory.sub;
        }
        return path[0] === activeCategory.root;
      });
    }

    // Apply search query
    if (searchQuery.trim()) {
      const results = fuse.search(searchQuery);
      list = results.map(r => r.item);
    }

    return list;
  }, [notes, activeCategory, searchQuery, fuse]);

  // Render Markdown Helper
  const renderMarkdown = (md) => {
    if (!md) return null;
    
    // Simple custom regex markdown formatter
    const formatted = md
      .replace(/^### (.*$)/gim, '<h3 style="color:#ffffff; margin:16px 0 8px 0; font-size:1.15rem; font-weight:600;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="color:#ffffff; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:6px; margin:24px 0 12px 0; font-size:1.35rem; font-weight:600;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="color:#ffffff; margin:28px 0 14px 0; font-size:1.6rem; font-weight:700;">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#8b5cf6; font-weight:600;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="color:#c084fc;">$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-family:monospace; font-size:0.9em; color:#a78bfa;">$1</code>')
      .replace(/^\s*-\s*\[\s*\]\s*(.*$)/gim, '<li style="list-style-type:none; margin-left:0; margin-bottom:6px;">⬜ $1</li>')
      .replace(/^\s*-\s*\[\s*[xX]\s*\]\s*(.*$)/gim, '<li style="list-style-type:none; margin-left:0; margin-bottom:6px; color:#9ca3af; text-decoration:line-through;">✅ $1</li>')
      .replace(/^\s*-\s*(.*$)/gim, '<li style="margin-left:18px; margin-bottom:6px;">$1</li>')
      .replace(/\n/g, '<br />');

    return (
      <div 
        className="markdown-body" 
        dangerouslySetInnerHTML={{ __html: formatted }} 
      />
    );
  };

  const getYoutubeEmbed = (url) => {
    let videoId = null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      videoId = match[2];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  };

  const getThumbnailUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('/api/')) {
      return `${API_URL}${url}?password=${password}`;
    }
    return url;
  };

  if (loading) {
    return (
      <div className="lock-screen" style={{ color: '#9ca3af' }}>
        <RefreshCw className="animate-spin" size={36} style={{ color: '#8b5cf6' }} />
      </div>
    );
  }

  // Password Lock Screen
  if (!isAuthenticated) {
    return (
      <div className="app-container">
        {/* Ambient background glowing blobs */}
        <div className="ambient-blobs">
          <div className="blob-1"></div>
          <div className="blob-2"></div>
        </div>

        <div className="lock-screen">
          <div className="lock-container glass-panel">
            <div className="logo-icon" style={{ margin: '0 auto 16px auto' }}>
              <Lock size={20} color="#fff" />
            </div>
            <h2 style={{ fontFamily: 'Outfit', fontWeight: 600 }}>Remind AI</h2>
            <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>Enter credentials to access local PKM Vault</p>
            <form onSubmit={handleLoginSubmit}>
              <input 
                type="text" 
                className="lock-input"
                placeholder="User ID (e.g. user_1)"
                value={userIdInput}
                onChange={(e) => setUserIdInput(e.target.value)}
                required
                style={{ marginTop: 20, marginBottom: 8 }}
              />
              <input 
                type="password" 
                className="lock-input"
                placeholder="Password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                required
                style={{ marginTop: 8, marginBottom: 16 }}
              />
              {loginError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 16 }}>{loginError}</p>}
              <button type="submit" className="action-btn" style={{ width: '100%', justifyContent: 'center' }}>
                Decrypt Vault
              </button>
            </form>
            {isCapacitor && (
              <button 
                type="button"
                className="action-btn" 
                style={{ 
                  width: '100%', 
                  justifyContent: 'center', 
                  marginTop: 12, 
                  backgroundColor: 'rgba(139, 92, 246, 0.1)', 
                  border: '1px dashed var(--violet-primary)' 
                }}
                onClick={() => setShowSettings(true)}
              >
                <Settings size={16} style={{ marginRight: 8 }} />
                Configure Server Connection
              </button>
            )}
          </div>
          {showSettings && (
            <div className="modal-overlay" onClick={() => setShowSettings(false)}>
              <div className="modal-container glass-panel settings-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600 }}>Connection Setup</h2>
                <button className="modal-close-btn" onClick={() => setShowSettings(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                <div className="settings-field">
                  <label>Server URL (e.g. http://192.168.1.5:5000)</label>
                  <input 
                    type="url"
                    className="url-input"
                    placeholder="http://192.168.x.x:5000"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '4px' }}>
                    Your PC and phone must be connected to the same WiFi network.
                  </span>
                </div>

                {settingsStatus && (
                  <p style={{ 
                    color: settingsStatus.includes('success') || settingsStatus.includes('Reloading') ? '#10b981' : '#ef4444', 
                    fontSize: 13, 
                    fontWeight: 600 
                  }}>
                    {settingsStatus}
                  </p>
                )}

                <button type="submit" className="action-btn" style={{ marginTop: '8px', justifyContent: 'center' }}>
                  Save Server URL
                </button>
              </form>
            </div>
          </div>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Ambient background glowing blobs */}
      <div className="ambient-blobs">
        <div className="blob-1"></div>
        <div className="blob-2"></div>
      </div>

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">
            <Sliders size={18} color="#fff" />
          </div>
          <span className="logo-text">Remind AI</span>
        </div>

        <div className="nav-buttons-container">
          <button 
            className={`cat-btn ${!activeCategory ? 'active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            <span>All Notes</span>
            <FileText size={16} />
          </button>

          <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '8px 0' }} />

          {Object.keys(categoriesMap).map((root) => {
            const subs = Array.from(categoriesMap[root]);
            const isExpanded = !!expandedCategories[root];
            const isRootActive = activeCategory?.root === root && !activeCategory.sub;
            
            return (
              <div key={root} className="cat-group">
                <div className="cat-row">
                  <button 
                    className={`cat-btn ${isRootActive ? 'active' : ''}`}
                    style={{ flexGrow: 1 }}
                    onClick={() => setActiveCategory({ root, sub: null })}
                  >
                    <span>{root}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameCategory([root]);
                    }}
                    className="cat-rename-icon-btn"
                    title={`Rename category ${root}`}
                  >
                    <Edit2 size={12} />
                  </button>
                  {subs.length > 0 && (
                    <button 
                      onClick={() => toggleCategoryExpand(root)}
                      className="cat-expand-btn"
                    >
                      <ChevronRight 
                        size={14} 
                        style={{ 
                          transform: isExpanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.2s'
                        }} 
                      />
                    </button>
                  )}
                </div>

                {isExpanded && subs.length > 0 && (
                  <div className="sub-cat-container">
                    {subs.map((sub) => {
                      const isSubActive = activeCategory?.root === root && activeCategory?.sub === sub;
                      return (
                        <div key={sub} className="sub-cat-row">
                          <button
                            className={`sub-cat-btn ${isSubActive ? 'active' : ''}`}
                            style={{ flexGrow: 1 }}
                            onClick={() => setActiveCategory({ root, sub })}
                          >
                            <ChevronRight size={10} />
                            <span>{sub}</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameCategory([root, sub]);
                            }}
                            className="cat-rename-icon-btn"
                            title={`Rename subcategory ${sub}`}
                          >
                            <Edit2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer Controls */}
        <div className="sidebar-footer" style={{ flexDirection: 'column' }}>
          {userId && (
            <div style={{ 
              fontSize: '11px', 
              color: 'var(--text-muted)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.03)',
              justifyContent: 'center',
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: '4px'
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
              <span>Vault: <strong>{userId}</strong></span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button 
              className="action-btn" 
              style={{ 
                background: 'rgba(255,255,255,0.03)', 
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                flexGrow: 1,
                justifyContent: 'center',
                padding: '10px'
              }}
              onClick={() => setShowSettings(true)}
            >
              <Settings size={16} />
              <span>Settings</span>
            </button>
            
            <button 
              className="action-btn" 
              style={{ 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                padding: '10px'
              }}
              onClick={handleLogout}
              title="Lock Vault"
            >
              <Lock size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-dashboard">
        {/* Header Search */}
        <header className="header-bar">
          <div>
            <h2 style={{ fontFamily: 'Outfit', fontSize: 20 }}>
              {activeCategory 
                ? `${activeCategory.root} ${activeCategory.sub ? `› ${activeCategory.sub}` : ''}`
                : 'Dashboard'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {filteredNotes.length} notes processed
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="search-container">
              <Search size={16} color="var(--text-muted)" />
              <input 
                type="text" 
                className="search-input" 
                placeholder="Search notes, tags, snippets..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button 
              className="action-btn"
              style={{
                background: isIngesting ? '#7c3aed' : 'rgba(139, 92, 246, 0.15)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                color: '#c084fc',
              }}
              onClick={triggerIngestion}
              disabled={isIngesting}
            >
              <RefreshCw className={isIngesting ? 'animate-spin' : ''} size={16} />
              <span>{isIngesting ? 'Syncing...' : 'Sync Ingest'}</span>
            </button>
          </div>
        </header>

        {/* Queue URL Paste Box */}
        <section className="paste-container glass-panel">
          <form onSubmit={handleAddToQueue} style={{ display: 'flex', width: '100%', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Plus size={20} color="var(--text-muted)" />
            <input 
              type="url" 
              className="url-input"
              placeholder="Paste Instagram Reel, YouTube, or Facebook Reel URL here..." 
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              required
            />
            <select 
              className="depth-select"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            >
              <option value="Quick Summary">Quick Summary</option>
              <option value="Detailed Notes">Detailed Notes</option>
              <option value="Fine-Grained Study">Fine-Grained Study</option>
            </select>
            <button type="submit" className="action-btn">
              Queue Ingest
            </button>
            <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} className="mobile-hide-divider" />
            <button 
              type="button"
              className="action-btn"
              style={{
                background: isIngesting ? '#7c3aed' : 'rgba(236, 72, 153, 0.15)',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                color: '#f472b6',
              }}
              onClick={triggerIngestion}
              disabled={isIngesting}
            >
              <RefreshCw className={isIngesting ? 'animate-spin' : ''} size={16} />
              <span>{isIngesting ? 'Processing Ingestion...' : 'Process Queue'}</span>
            </button>
          </form>
        </section>

        {/* Dashboard Grid */}
        <section className="content-area">
          {filteredNotes.length === 0 ? (
            <div className="empty-state">
              <Folder size={48} style={{ strokeWidth: 1.2, color: 'var(--text-muted)', marginBottom: 16 }} />
              <h3>No Notes Found</h3>
              <p style={{ fontSize: 13, marginTop: 4, maxWidth: 320 }}>
                {searchQuery ? 'Try adjusting your search terms.' : 'Paste a video URL above and hit Queue Ingest to organize your PKM tree.'}
              </p>
            </div>
          ) : (
            <div className="grid-layout">
              {filteredNotes.map((note) => {
                const isYoutube = note.url.includes('youtube.com') || note.url.includes('youtu.be') || note.url.includes('shorts');
                const isFacebook = note.url.includes('facebook.com') || note.url.includes('fb.watch') || note.url.includes('fb.com');
                return (
                  <div 
                    key={note.id} 
                    className="clip-card glass-panel"
                    onClick={() => loadNoteContent(note)}
                  >
                    <div className="clip-card-body" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '24px' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            {isYoutube ? 'YouTube' : isFacebook ? 'Facebook' : 'Instagram'}
                          </span>
                          <span className="clip-date" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{note.dateProcessed}</span>
                        </div>
                        <h3 className="clip-title" style={{ marginTop: '4px', fontSize: 16, lineHeight: 1.4, color: 'var(--text-primary)', fontWeight: 600 }}>{note.title}</h3>
                        <p className="clip-snippet" style={{ color: 'var(--text-secondary)', fontSize: 13, display: '-webkit-box', WebKitLineClamp: 3, WebKitBoxOrient: 'vertical', overflow: 'hidden', margin: '8px 0 16px 0', lineHeight: 1.5 }}>
                          {note.snippet || 'No description preview available.'}
                        </p>
                      </div>
                      
                      <div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                          {note.tags && note.tags.length > 0 ? (
                            note.tags.slice(0, 4).map(tag => (
                              <span key={tag} className="tag-badge" style={{ fontSize: 11 }}>{tag}</span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic' }}>No tags</span>
                          )}
                        </div>

                        <div className="clip-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="tag-badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {note.categoryPath ? note.categoryPath.join(' › ') : 'General'}
                          </span>
                          <span style={{ fontSize: 11, color: '#c084fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>Read Note</span>
                            <ChevronRight size={12} />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Real-time Console Log Drawer */}
        <div className={`logs-drawer ${showConsole ? 'open' : ''}`}>
          <div className="logs-header">
            <span style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981' }}>
              <Terminal size={14} />
              <span>Pipeline Logs Ingestion Drawer</span>
              {isIngesting && <span style={{ background: '#059669', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: '4px', animation: 'pulse 2s infinite' }}>PROCESSING</span>}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setConsoleLogs('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}
              >
                Clear
              </button>
              <button 
                onClick={() => setShowConsole(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="logs-content">
            {consoleLogs || 'No logs recorded. Queue URL and click Sync Ingest to run the extraction pipeline.'}
          </div>
        </div>
      </main>

      {/* Split Reading View Modal */}
      {selectedNote && (
        <div className="modal-overlay" onClick={() => setSelectedNote(null)}>
          <div className="modal-container glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="tag-badge" style={{ verticalAlign: 'middle', marginRight: '8px' }}>
                  {selectedNote.categoryPath.join(' / ')}
                </span>
                <h2 style={{ display: 'inline-block', fontSize: 18, fontFamily: 'Outfit', fontWeight: 600, verticalAlign: 'middle' }}>
                  {selectedNote.title}
                </h2>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedNote(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-content-split">
              {/* Left Column: AI Markdown Summary */}
              <div className="modal-left-pane">
                {loadingNote ? (
                  <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw className="animate-spin" size={24} color="#8b5cf6" />
                  </div>
                ) : (
                  renderMarkdown(noteContent)
                )}
              </div>

              {/* Right Column: Source Link and Details */}
              <div className="modal-right-pane">
                {isEditingMeta ? (
                  <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>Edit Metadata</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Category Path</label>
                      <select 
                        className="depth-select" 
                        value={editCategorySelect} 
                        onChange={(e) => setEditCategorySelect(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px' }}
                      >
                        {existingCategoryPaths.map(path => (
                          <option key={path} value={path}>{path}</option>
                        ))}
                        <option value="NEW_CATEGORY">-- Create New Category --</option>
                      </select>
                    </div>

                    {editCategorySelect === 'NEW_CATEGORY' && (
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Main Category</label>
                          <input 
                            type="text" 
                            className="url-input" 
                            placeholder="e.g. AI" 
                            value={newMainCategory} 
                            onChange={(e) => setNewMainCategory(e.target.value)} 
                            style={{ padding: '10px 12px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Subcategory</label>
                          <input 
                            type="text" 
                            className="url-input" 
                            placeholder="e.g. Agents" 
                            value={newSubCategory} 
                            onChange={(e) => setNewSubCategory(e.target.value)} 
                            style={{ padding: '10px 12px' }}
                          />
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tags (comma-separated)</label>
                      <input 
                        type="text" 
                        className="url-input" 
                        placeholder="e.g. Option Trading, Stocks" 
                        value={editTagsInput} 
                        onChange={(e) => setEditTagsInput(e.target.value)} 
                        style={{ width: '100%', padding: '10px 12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                      <button 
                        type="button" 
                        className="action-btn" 
                        style={{ flex: 1, justifyContent: 'center' }} 
                        onClick={handleSaveMetadata}
                        disabled={savingMeta}
                      >
                        {savingMeta ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button 
                        type="button" 
                        className="action-btn" 
                        style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} 
                        onClick={() => setIsEditingMeta(false)}
                        disabled={savingMeta}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700 }}>Source Metadata</h3>
                      
                      {/* YouTube Iframe Player if applicable */}
                      {getYoutubeEmbed(selectedNote.url) ? (
                        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                          <iframe
                            src={getYoutubeEmbed(selectedNote.url)}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                            frameBorder="0"
                            allowFullScreen
                          />
                        </div>
                      ) : (
                        // Instagram Thumbnail and redirect
                        selectedNote.thumbnailUrl && (
                          <div style={{ height: '200px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                            <img 
                              src={getThumbnailUrl(selectedNote.thumbnailUrl)} 
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              alt="Thumbnail preview"
                            />
                          </div>
                        )
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Source Link:</span>
                          <a href={selectedNote.url} target="_blank" rel="noopener noreferrer" style={{ color: '#c084fc', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span>Open Video</span>
                            <ExternalLink size={12} />
                          </a>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Processed At:</span>
                          <span style={{ color: 'var(--text-primary)' }}>{selectedNote.dateProcessed}</span>
                        </div>
                      </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '24px', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700 }}>Keywords & Taxonomy</h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {selectedNote.tags.length > 0 ? (
                          selectedNote.tags.map(tag => (
                            <span key={tag} className="tag-badge" style={{ fontSize: 12 }}>{tag}</span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No tags assigned</span>
                        )}
                      </div>
                      <div style={{ marginTop: '16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        <p style={{ fontWeight: 600, color: '#fff', marginBottom: '6px' }}>Folder Location:</p>
                        <code style={{ background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: '6px', display: 'block', wordBreak: 'break-all' }}>
                          {selectedNote.filePath}
                        </code>
                      </div>
                      
                      <button 
                        className="action-btn"
                        style={{
                          width: '100%',
                          marginTop: '20px',
                          background: 'rgba(139, 92, 246, 0.15)',
                          color: '#c084fc',
                          border: '1px solid rgba(139, 92, 246, 0.3)',
                          justifyContent: 'center'
                        }}
                        onClick={() => setIsEditingMeta(true)}
                      >
                        ✏️ Edit Classification & Tags
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-container glass-panel settings-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600 }}>Credentials Configuration</h2>
              <button className="modal-close-btn" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
              <div className="settings-field">
                <label>Server URL (for mobile app)</label>
                <input 
                  type="url"
                  className="url-input"
                  placeholder="e.g. http://192.168.1.100:5000"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '4px' }}>
                  Set this to your PC's local IP if using the Android app
                </span>
              </div>
              <div className="settings-field">
                <label>Google Gemini API Key</label>
                <input 
                  type="password"
                  className="url-input"
                  placeholder="Paste GEMINI_API_KEY (hidden)"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label>NVIDIA API Key</label>
                <input 
                  type="password"
                  className="url-input"
                  placeholder="Paste NVIDIA_API_KEY (hidden)"
                  value={nvidiaKey}
                  onChange={(e) => setNvidiaKey(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label>Apify API Token</label>
                <input 
                  type="password"
                  className="url-input"
                  placeholder="Paste APIFY_TOKEN (hidden)"
                  value={apifyToken}
                  onChange={(e) => setApifyToken(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label>New App Password</label>
                <input 
                  type="password"
                  className="url-input"
                  placeholder="Update lock screen password"
                  value={newAppPassword}
                  onChange={(e) => setNewAppPassword(e.target.value)}
                />
              </div>

              {settingsStatus && (
                <p style={{ 
                  color: settingsStatus.includes('success') ? '#10b981' : '#ef4444', 
                  fontSize: 13, 
                  fontWeight: 600 
                }}>
                  {settingsStatus}
                </p>
              )}

              <button type="submit" className="action-btn" style={{ marginTop: '8px', justifyContent: 'center' }}>
                Save Settings
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
