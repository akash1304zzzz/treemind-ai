import React, { useState, useEffect, useMemo } from 'react';
import posthog from 'posthog-js';
import Fuse from 'fuse.js';
import TechTreeGraph from './TechTreeGraph';
import AdminView from './AdminView';
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
  Shield,
  FileText,
  Edit2,
  Home,
  User,
  Camera,
  Grid,
  Network
} from 'lucide-react';

const API_BASE = ''; // Proxy-less since Vite serves from same domain in production, but we fallback to port 5000 in dev
// Capacitor Android: app runs from local assets, needs explicit backend URL
// Users set their server IP in Settings; stored in localStorage as 'treemind_server_url'
const isCapacitor = window.Capacitor !== undefined;

// ── Admin Login Form (standalone page component) ──
function AdminLoginForm({ apiUrl, onSuccess, onBack }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!pwd) return;
    setLoading(true); setError('');
    fetch(`${apiUrl}/api/admin/stats`, { headers: { 'x-admin-password': pwd } })
      .then(r => {
        if (r.ok) onSuccess(pwd);
        else setError('Invalid admin password');
      })
      .catch(() => setError('Connection failed'))
      .finally(() => setLoading(false));
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="password" placeholder="Admin Password" value={pwd} onChange={e => setPwd(e.target.value)}
        required style={{
          width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-color)',
          background: 'var(--bg-deep)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
          textAlign: 'center'
        }} />
      {error && <p style={{ color: '#ef4444', fontSize: 12, margin: 0 }}>{error}</p>}
      <button type="submit" className="action-btn" disabled={loading}
        style={{ width: '100%', justifyContent: 'center', opacity: loading ? 0.6 : 1 }}>
        {loading ? 'Verifying...' : <><Shield size={14} style={{ marginRight: 6 }} /> Enter Admin</>}
      </button>
      <button type="button" onClick={onBack}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
          fontSize: 13, padding: '4px 0', marginTop: 4
        }}>
        ← Back to Login
      </button>
    </form>
  );
}

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
  const [dashboardView, setDashboardView] = useState('grid'); // 'grid' or 'tree'
  const [expandedCategories, setExpandedCategories] = useState({}); // { [root]: boolean }
  const [searchQuery, setSearchQuery] = useState('');
  
  // Profile & Limits State
  const [profileName, setProfileName] = useState(() => localStorage.getItem('tm_profile_name') || '');
  const [profileEmail, setProfileEmail] = useState(() => localStorage.getItem('tm_profile_email') || '');
  const [profilePlatforms, setProfilePlatforms] = useState(() => {
    try {
      const saved = localStorage.getItem('tm_profile_platforms');
      return saved ? JSON.parse(saved) : { youtube: true, instagram: true, tiktok: true };
    } catch {
      return { youtube: true, instagram: true, tiktok: true };
    }
  });
  const [profileSavedFlash, setProfileSavedFlash] = useState(false);

  const monthlyIngestCount = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return notes.filter(note => {
      if (!note.dateProcessed) return false;
      const datePart = note.dateProcessed.split(' ')[0];
      const parts = datePart.split('-');
      if (parts.length < 2) return false;
      return parseInt(parts[0], 10) === currentYear && parseInt(parts[1], 10) === currentMonth;
    }).length;
  }, [notes]);
  
  // URL Input State
  const [newUrl, setNewUrl] = useState('');
  const [depth, setDepth] = useState('Detailed Notes');

  // Modal State
  const [selectedNote, setSelectedNote] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [loadingNote, setLoadingNote] = useState(false);
  const [chatTab, setChatTab] = useState('details'); // 'details' | 'chat'
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  
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
  const [deletingNote, setDeletingNote] = useState(false);
  const [mobileTab, setMobileTab] = useState('home'); // 'home', 'folders', 'queue', 'profile'
  const [showIngestForm, setShowIngestForm] = useState(false);
  const [urlQueued, setUrlQueued] = useState(false); // brief success flash after queuing
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [editingCategoryPath, setEditingCategoryPath] = useState(null); // e.g. [root] or [root, sub]
  const [renameInputValue, setRenameInputValue] = useState('');

  // Admin Dashboard State — page-based routing (no router needed)
  // 'login' = normal app login, 'admin-login' = admin password page, 'admin' = admin dashboard
  const [viewMode, setViewMode] = useState('login');
  const [adminPassword, setAdminPassword] = useState('');

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
        body: JSON.stringify({ password: pass, user_id: usrId })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setPassword(pass);
        setUserId(usrId);
        localStorage.setItem('tm_password', pass);
        localStorage.setItem('tm_user_id', usrId);
        posthog.identify(usrId);
        posthog.capture('user_login', { userId: usrId });
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
        'x-user-id': usrId,
        'Bypass-Tunnel-Reminder': 'true'
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
  // Chatbot logic functions
  const fetchChatHistory = async (noteId) => {
    try {
      const res = await fetch(`${API_URL}/api/note/${noteId}/chat`, {
        headers: {
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setChatMessages(data.messages || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch chat history:', e);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const text = chatInput.trim();
    if (!text || !selectedNote) return;

    // Optimistically update chat history
    setChatMessages(prev => [...prev, { role: 'user', content: text }]);
    setChatInput('');
    setSendingMessage(true);

    try {
      const res = await fetch(`${API_URL}/api/note/${selectedNote.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        },
        body: JSON.stringify({ message: text })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setChatMessages(data.messages || []);
        } else {
          alert('Error: ' + (data.error || 'Failed to send message'));
        }
      } else {
        const errText = await res.text();
        let parsedErr = errText;
        try {
          const errJson = JSON.parse(errText);
          parsedErr = errJson.error || errText;
        } catch (_) {}
        alert('Error: ' + parsedErr);
      }
    } catch (err) {
      alert('Network error: ' + err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleResetChat = async () => {
    if (!selectedNote) return;
    if (!window.confirm('Are you sure you want to reset and clear the chat history for this summary?')) return;
    
    setSendingMessage(true);
    try {
      const res = await fetch(`${API_URL}/api/note/${selectedNote.id}/chat/reset`, {
        method: 'POST',
        headers: {
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setChatMessages([]);
        }
      } else {
        alert('Failed to reset chat history.');
      }
    } catch (err) {
      alert('Network error: ' + err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Load specific note content
  const loadNoteContent = async (note) => {
    setLoadingNote(true);
    setSelectedNote(note);
    setNoteContent('');
    setChatTab('details');
    setChatMessages([]);
    setChatInput('');
    fetchChatHistory(note.id);

    posthog.capture('note_viewed', { 
      noteId: note.id, 
      title: note.title, 
      categoryPath: note.categoryPath 
    });
    
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
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (res.ok) {
        const text = await res.text();
        // Remove yaml frontmatter for rendering
        const cleaned = text.replace(/^---[\s\S]*?---\n*/, '');
        // Also strip chat history block if present in loaded file content
        const cleanContent = cleaned.replace(/<!-- CHAT_HISTORY_JSON:[\s\S]*?-->/g, '').trim();
        setNoteContent(cleanContent);
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

    if (monthlyIngestCount >= 20) {
      alert('Usage Limit Reached: Free Tier accounts are limited to 20 video summaries per month. Please go to the My Profile tab and upgrade to Premium for unlimited summaries!');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/queue`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        },
        body: JSON.stringify({ url: newUrl, depth })
      });

      if (res.ok) {
        setUrlQueued(true);
        setShowConsole(true);
        posthog.capture('video_queued', { url: newUrl, depth });
        setConsoleLogs(prev => prev + `[System] Queued URL: ${newUrl} with depth: ${depth}\n`);
        // Flash success for 2 seconds then clear input but keep form open
        setTimeout(() => { setUrlQueued(false); setNewUrl(''); fetchData(); }, 2000);
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
    posthog.capture('queue_ingestion_started');
    setConsoleLogs(prev => prev + `[Ingest] Launching pipeline ingestion...\n`);
    
    let hasMore = true;
    let loopCount = 0;
    
    try {
      while (hasMore) {
        if (loopCount > 0) {
          setConsoleLogs(prev => prev + `[Ingest] Processing next item in queue...\n`);
        }
        
        const res = await fetch(`${API_URL}/api/ingest`, {
          method: 'POST',
          headers: { 
            'x-app-password': password,
            'x-user-id': userId,
            'Bypass-Tunnel-Reminder': 'true'
          }
        });
        
        if (!res.ok) {
          const errMsg = await res.text();
          throw new Error(errMsg || `HTTP ${res.status}`);
        }
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        
        let done = false;
        let buffer = '';
        let metadata = null;
        
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          
          if (value) {
            const textChunk = decoder.decode(value, { stream: !done });
            buffer += textChunk;
            
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep last incomplete line in buffer
            
            for (const line of lines) {
              if (line.startsWith('__METADATA__:')) {
                try {
                  metadata = JSON.parse(line.substring(13));
                } catch (e) {
                  console.error('Failed to parse metadata:', e);
                }
              } else {
                if (line.trim()) {
                  setConsoleLogs(prev => prev + line + '\n');
                }
              }
            }
          }
        }
        
        if (buffer) {
          if (buffer.startsWith('__METADATA__:')) {
            try {
              metadata = JSON.parse(buffer.substring(13));
            } catch (e) {}
          } else {
            if (buffer.trim()) {
              setConsoleLogs(prev => prev + buffer + '\n');
            }
          }
        }
        
        if (metadata && metadata.success) {
          setConsoleLogs(prev => prev + `[Success] Batch finished.\n`);
          fetchData();
          
          if (metadata.remainingCount && metadata.remainingCount > 0) {
            hasMore = true;
            loopCount++;
            await new Promise(resolve => setTimeout(resolve, 1500));
          } else {
            hasMore = false;
            setConsoleLogs(prev => prev + `[Success] All items in queue have been processed!\n`);
          }
        } else {
          const err = metadata ? metadata.error : 'Unknown ingestion error';
          setConsoleLogs(prev => prev + `[Error] Ingestion failed: ${err}\n`);
          hasMore = false;
        }
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
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
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

  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    if (!window.confirm(`Are you sure you want to permanently delete "${selectedNote.title}"?`)) {
      return;
    }

    setDeletingNote(true);
    try {
      const res = await fetch(`${API_URL}/api/note/delete`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
        },
        body: JSON.stringify({ id: selectedNote.id })
      });

      if (res.ok) {
        setSelectedNote(null);
        fetchData();
      } else {
        const errorData = await res.json();
        alert('Error deleting note: ' + (errorData.error || res.statusText));
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    } finally {
      setDeletingNote(false);
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
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
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

  const submitRenameCategory = async (oldPath, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      alert('Category name cannot be empty.');
      return;
    }
    if (trimmed === oldPath[oldPath.length - 1]) {
      setEditingCategoryPath(null);
      return; // no change
    }

    const newPath = [...oldPath];
    newPath[newPath.length - 1] = trimmed;

    try {
      const res = await fetch(`${API_URL}/api/category/rename`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-password': password,
          'x-user-id': userId,
          'Bypass-Tunnel-Reminder': 'true'
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
    } finally {
      setEditingCategoryPath(null);
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
      .replace(/^### (.*$)/gim, '<h3 style="color:var(--text-primary); margin:16px 0 8px 0; font-size:1.15rem; font-weight:600;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="color:var(--text-primary); border-bottom:1px solid var(--border-color); padding-bottom:6px; margin:24px 0 12px 0; font-size:1.35rem; font-weight:600;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="color:var(--text-primary); margin:28px 0 14px 0; font-size:1.6rem; font-weight:700;">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent-primary); font-weight:600;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="color:var(--text-secondary);">$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:var(--bg-base); padding:2px 6px; border-radius:4px; font-family:monospace; font-size:0.9em; color:var(--accent-primary);">$1</code>')
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
      return `${API_URL}${url}?password=${password}&userId=${userId}`;
    }
    return url;
  };

  if (loading) {
    return (
      <div className="lock-screen" style={{ color: 'var(--text-muted)' }}>
        <RefreshCw className="animate-spin" size={36} style={{ color: 'var(--accent-primary)' }} />
      </div>
    );
  }

  // ── Admin Login Page (standalone) ──
  if (viewMode === 'admin-login') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
            <Shield size={24} color="#38bdf8" />
          </div>
          <h2 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Admin Access</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Enter the admin password to continue</p>
          <AdminLoginForm
            apiUrl={API_URL}
            onSuccess={(pwd) => { setAdminPassword(pwd); setViewMode('admin'); }}
            onBack={() => setViewMode('login')}
          />
        </div>
      </div>
    );
  }

  // ── Admin Dashboard Page (standalone) ──
  if (viewMode === 'admin') {
    return (
      <AdminView adminPassword={adminPassword} apiUrl={API_URL}
        onLogout={() => { setAdminPassword(''); setViewMode('login'); }} />
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
            <h2 style={{ fontFamily: 'Outfit', fontWeight: 600 }}>TreeMind AI</h2>
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
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setViewMode('admin-login'); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 12, marginTop: 16,
                  display: 'flex', alignItems: 'center', gap: 4, margin: '16px auto 0 auto'
                }}
              >
                <Shield size={12} /> Admin
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
                  backgroundColor: 'var(--accent-glow)', 
                  border: '1px dashed var(--accent-primary)',
                  color: 'var(--accent-primary)'
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
      <aside className={`sidebar ${mobileTab === 'folders' ? 'sidebar-mobile-active' : ''}`}>
        <div className="logo-container">
          <div className="logo-icon">
            <Sliders size={18} color="#fff" />
          </div>
          <span className="logo-text">TreeMind AI</span>
        </div>

        <div className="nav-buttons-container">
          <button 
            className={`cat-btn ${!activeCategory && mobileTab === 'home' ? 'active' : ''}`}
            onClick={() => { setActiveCategory(null); setMobileTab('home'); }}
          >
            <span>All Notes</span>
            <FileText size={16} />
          </button>

          <button 
            className={`cat-btn ${mobileTab === 'profile' ? 'active' : ''}`}
            onClick={() => { setActiveCategory(null); setMobileTab('profile'); }}
          >
            <span>My Profile</span>
            <User size={16} />
          </button>

          <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '8px 0' }} />

          {Object.keys(categoriesMap).map((root) => {
            const subs = Array.from(categoriesMap[root]);
            const isExpanded = !!expandedCategories[root];
            const isRootActive = activeCategory?.root === root && !activeCategory.sub;
            const isEditingRoot = editingCategoryPath && editingCategoryPath.length === 1 && editingCategoryPath[0] === root;
            
            return (
              <div key={root} className="cat-group">
                <div className="cat-row" style={{ alignItems: 'center' }}>
                  {isEditingRoot ? (
                    <input
                      type="text"
                      className="url-input"
                      style={{ flexGrow: 1, padding: '8px 12px', fontSize: '13.5px', background: 'var(--bg-deep)', border: '1px solid var(--accent-primary)' }}
                      value={renameInputValue}
                      onChange={(e) => setRenameInputValue(e.target.value)}
                      onBlur={() => submitRenameCategory([root], renameInputValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          submitRenameCategory([root], renameInputValue);
                        } else if (e.key === 'Escape') {
                          setEditingCategoryPath(null);
                        }
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <button 
                      className={`cat-btn ${isRootActive ? 'active' : ''}`}
                      style={{ flexGrow: 1 }}
                      onClick={() => { setActiveCategory({ root, sub: null }); setMobileTab('home'); }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingCategoryPath([root]);
                        setRenameInputValue(root);
                      }}
                      title="Double click to rename"
                    >
                      <span>{root}</span>
                    </button>
                  )}
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
                      const isEditingSub = editingCategoryPath && editingCategoryPath.length === 2 && editingCategoryPath[0] === root && editingCategoryPath[1] === sub;
                      
                      return (
                        <div key={sub} className="sub-cat-row" style={{ alignItems: 'center' }}>
                          {isEditingSub ? (
                            <input
                              type="text"
                              className="url-input"
                              style={{ flexGrow: 1, padding: '6px 10px', fontSize: '12.5px', background: 'var(--bg-deep)', border: '1px solid var(--accent-primary)' }}
                              value={renameInputValue}
                              onChange={(e) => setRenameInputValue(e.target.value)}
                              onBlur={() => submitRenameCategory([root, sub], renameInputValue)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  submitRenameCategory([root, sub], renameInputValue);
                                } else if (e.key === 'Escape') {
                                  setEditingCategoryPath(null);
                                }
                              }}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <button
                              className={`sub-cat-btn ${isSubActive ? 'active' : ''}`}
                              style={{ flexGrow: 1 }}
                              onClick={() => { setActiveCategory({ root, sub }); setMobileTab('home'); }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingCategoryPath([root, sub]);
                                setRenameInputValue(sub);
                              }}
                              title="Double click to rename"
                            >
                              <ChevronRight size={10} />
                              <span>{sub}</span>
                            </button>
                          )}
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
      <main className={`main-dashboard ${mobileTab === 'folders' ? 'mobile-hide-main' : ''}`}>
        {/* Header Search */}
        <header className="header-bar">
          <div>
            <h2 style={{ fontFamily: 'Outfit', fontSize: 20 }}>
              {mobileTab === 'queue' ? 'Processing Queue' :
               mobileTab === 'profile' ? 'Profile & Settings' :
               activeCategory 
                ? `${activeCategory.root} ${activeCategory.sub ? `› ${activeCategory.sub}` : ''}`
                : 'Dashboard'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {mobileTab === 'queue' ? `${queue.filter(q => !q.processed).length} pending items` :
               mobileTab === 'profile' ? `Vault ID: ${userId}` :
               `${notes.length} note${notes.length !== 1 ? 's' : ''} processed`}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {mobileTab === 'home' && (
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
            )}

            {mobileTab === 'home' && (
              <div className="view-toggle-container" style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '3px', gap: '2px' }}>
                <button 
                  className={`view-toggle-btn ${dashboardView === 'grid' ? 'active' : ''}`}
                  onClick={() => setDashboardView('grid')}
                  style={{ padding: '6px 12px', border: 'none', display: 'flex', gap: '6px', alignItems: 'center' }}
                >
                  <Grid size={14} />
                  <span>Grid</span>
                </button>
                <button 
                  className={`view-toggle-btn ${dashboardView === 'tree' ? 'active' : ''}`}
                  onClick={() => setDashboardView('tree')}
                  style={{ padding: '6px 12px', border: 'none', display: 'flex', gap: '6px', alignItems: 'center' }}
                >
                  <Network size={14} />
                  <span>Tech Tree</span>
                </button>
              </div>
            )}

            {mobileTab === 'home' && (
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
            )}
          </div>
        </header>
        {/* Minimalist Ingest Button & Form Drawer */}
        {mobileTab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '24px 0', width: '100%', boxSizing: 'border-box' }}>
            {!showIngestForm ? (
              <button 
                onClick={() => setShowIngestForm(true)}
                className="action-btn"
                style={{
                  background: '#0f172a',
                  color: '#fff',
                  borderRadius: '24px',
                  padding: '14px 32px',
                  fontSize: '15px',
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-md)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Plus size={18} />
                <span>Ingest Link</span>
              </button>
            ) : (
              <section className="paste-container glass-panel" style={{ width: 'calc(100% - 80px)', margin: '0 40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Paste Source URL</span>
                  <button 
                    onClick={() => setShowIngestForm(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleAddToQueue} style={{ display: 'flex', width: '100%', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                  <button type="submit" className="action-btn" style={{ background: urlQueued ? '#16a34a' : '#0f172a', transition: 'background 0.3s' }}>
                    {urlQueued ? '✓ Queued!' : 'Queue Ingest'}
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
            )}
          </div>
        )}

        {/* Dashboard Grid / Recent List Toggle */}
        {mobileTab === 'home' && (
          <section className="content-area">
            {dashboardView === 'tree' ? (
              <TechTreeGraph notes={filteredNotes} onSelectNote={loadNoteContent} />
            ) : (searchQuery.trim().length > 0 || showAllNotes) ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700 }}>
                    {searchQuery ? `Search Results for "${searchQuery}"` : 'All Processing History'}
                  </h3>
                  {showAllNotes && !searchQuery && (
                    <button 
                      onClick={() => setShowAllNotes(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-primary)',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600
                      }}
                    >
                      Show Less
                    </button>
                  )}
                </div>
                
                {filteredNotes.length === 0 ? (
                  <div className="empty-state">
                    <Folder size={48} style={{ strokeWidth: 1.2, color: 'var(--text-muted)', marginBottom: 16 }} />
                    <h3>No Notes Found</h3>
                    <p style={{ fontSize: 13, marginTop: 4, maxWidth: 320 }}>
                      {searchQuery ? 'Try adjusting your search terms.' : 'Paste a video URL above and hit Queue Ingest.'}
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
                                <span style={{ fontSize: 10, color: 'var(--accent-primary)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
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

                              <div className="clip-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="tag-badge" style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {note.categoryPath ? note.categoryPath.join(' • ') : 'General'}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
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
              </>
            ) : (
              /* Minimalist Recent Processing list matching Stitch mockup */
              <div className="recent-processing-container" style={{ maxWidth: '600px', margin: '16px auto', width: '100%' }}>
                <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '16px', paddingLeft: '8px' }}>Recent Processing</h3>
                <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
                  {filteredNotes.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
                      No notes processed yet. Paste a link above to start!
                    </div>
                  ) : (
                    filteredNotes.slice(0, 3).map((note) => {
                      const isYoutube = note.url.includes('youtube.com') || note.url.includes('youtu.be') || note.url.includes('shorts');
                      const isFacebook = note.url.includes('facebook.com') || note.url.includes('fb.watch') || note.url.includes('fb.com');
                      
                      // Icons matching Stitch styles
                      const iconColor = isYoutube ? '#ba1a1a' : isFacebook ? '#006591' : '#db2777';
                      const IconComponent = isYoutube ? Play : isFacebook ? FileText : Camera;
                      
                      return (
                        <div 
                          key={note.id} 
                          onClick={() => loadNoteContent(note)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '18px 24px',
                            borderBottom: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                          className="recent-row-item"
                        >
                          <div style={{ marginRight: '16px', display: 'flex', alignItems: 'center' }}>
                            <IconComponent size={20} color={iconColor} style={{ fill: isYoutube ? 'rgba(186, 26, 26, 0.1)' : 'none' }} />
                          </div>
                          <span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flexGrow: 1, marginRight: '16px' }}>
                            {note.title}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {note.dateProcessed.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                
                {filteredNotes.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
                    <button 
                      onClick={() => setShowAllNotes(true)}
                      className="view-all-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 24px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-elevated)',
                        borderRadius: '24px',
                        color: 'var(--accent-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>View All Recent</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}


        {/* Mobile Queue View */}
        {mobileTab === 'queue' && (
          <section className="content-area" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Queue Pipeline Actions</h3>
              <button 
                type="button"
                className="action-btn"
                style={{
                  background: isIngesting ? '#7c3aed' : 'var(--accent-primary)',
                  color: '#fff',
                  padding: '8px 16px'
                }}
                onClick={triggerIngestion}
                disabled={isIngesting}
              >
                <RefreshCw className={isIngesting ? 'animate-spin' : ''} size={14} />
                <span style={{ fontSize: 12 }}>{isIngesting ? 'Syncing...' : 'Sync Ingest'}</span>
              </button>
            </div>

            {/* Ingestion Status Info */}
            <div style={{ background: '#0f172a', padding: '16px', borderRadius: '8px', color: '#10b981', fontFamily: 'monospace', fontSize: '11px', maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
              {consoleLogs || 'No active logs. Queue a URL on the Home tab and tap Sync Ingest to run the extraction pipeline.'}
            </div>

            {/* Queue List Table */}
            <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Pending Items ({queue.filter(q => !q.processed).length})</h4>
              
              {queue.filter(q => !q.processed).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>No pending URLs in the queue.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {queue.filter(q => !q.processed).map((item, idx) => (
                    <div key={idx} style={{ padding: '12px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ minWidth: 0, flex: 1, marginRight: '12px' }}>
                        <p style={{ fontSize: 13, fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{item.url}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Added: {item.addedTime || 'Recent'} • {item.depth}</p>
                      </div>
                      <span className="tag-badge" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-primary)', fontSize: 10 }}>Queued</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Recently Processed</h4>
              {queue.filter(q => q.processed).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>No processed items in history.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                  {queue.filter(q => q.processed).slice(0, 10).map((item, idx) => (
                    <div key={idx} style={{ padding: '12px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.75 }}>
                      <div style={{ minWidth: 0, flex: 1, marginRight: '12px' }}>
                        <p style={{ fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{item.url}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Processed: {item.processedTime}</p>
                      </div>
                      <span className="tag-badge" style={{ background: 'var(--bg-elevated)', color: '#10b981', fontSize: 10 }}>Success</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Mobile Profile View */}
        {mobileTab === 'profile' && (
          <section className="content-area" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: 18, fontFamily: 'Outfit', fontWeight: 700 }}>My Account & Profile</h3>

            {/* Ingestion Limit progress card */}
            <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ fontSize: 16, fontWeight: 600 }}>Active Plan: <span style={{ color: 'var(--accent-primary)' }}>Free Tier</span></h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                    Each user is limited to 20 video summaries per month.
                  </p>
                </div>
                <span className="tag-badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', border: '1px solid rgba(139, 92, 246, 0.3)', fontSize: 11, padding: '4px 12px' }}>
                  Free Account
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: '6px', fontWeight: 500 }}>
                  <span>Ingested this Month</span>
                  <span style={{ color: monthlyIngestCount >= 20 ? '#ef4444' : 'var(--text-primary)' }}>
                    {monthlyIngestCount} / 20 videos
                  </span>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      width: `${Math.min(100, (monthlyIngestCount / 20) * 100)}%`, 
                      height: '100%', 
                      background: monthlyIngestCount >= 20 ? '#ef4444' : 'linear-gradient(90deg, #8b5cf6, #c084fc)',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
                {monthlyIngestCount >= 20 && (
                  <p style={{ color: '#ef4444', fontSize: 12, marginTop: '8px', fontWeight: 500 }}>
                    ⚠️ You have reached your monthly ingestion limit. Please upgrade to request unlimited summaries!
                  </p>
                )}
              </div>
            </div>

            {/* Profile Info Form Card */}
            <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ fontSize: 15, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                User Description & Settings
              </h4>
              
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  localStorage.setItem('tm_profile_name', profileName);
                  localStorage.setItem('tm_profile_email', profileEmail);
                  localStorage.setItem('tm_profile_platforms', JSON.stringify(profilePlatforms));
                  setProfileSavedFlash(true);
                  setTimeout(() => setProfileSavedFlash(false), 2500);
                }} 
                style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Full Name</label>
                  <input 
                    type="text" 
                    className="url-input" 
                    placeholder="Enter your name" 
                    value={profileName} 
                    onChange={(e) => setProfileName(e.target.value)} 
                    style={{ width: '100%', padding: '10px 12px' }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Email Address</label>
                  <input 
                    type="email" 
                    className="url-input" 
                    placeholder="Enter your email" 
                    value={profileEmail} 
                    onChange={(e) => setProfileEmail(e.target.value)} 
                    style={{ width: '100%', padding: '10px 12px' }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Social Platforms Used</label>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 13 }}>
                      <input 
                        type="checkbox" 
                        checked={!!profilePlatforms.youtube} 
                        onChange={(e) => setProfilePlatforms(prev => ({ ...prev, youtube: e.target.checked }))}
                        style={{ accentColor: '#8b5cf6', width: '16px', height: '16px' }}
                      />
                      <span>YouTube</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 13 }}>
                      <input 
                        type="checkbox" 
                        checked={!!profilePlatforms.instagram} 
                        onChange={(e) => setProfilePlatforms(prev => ({ ...prev, instagram: e.target.checked }))}
                        style={{ accentColor: '#8b5cf6', width: '16px', height: '16px' }}
                      />
                      <span>Instagram</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 13 }}>
                      <input 
                        type="checkbox" 
                        checked={!!profilePlatforms.tiktok} 
                        onChange={(e) => setProfilePlatforms(prev => ({ ...prev, tiktok: e.target.checked }))}
                        style={{ accentColor: '#8b5cf6', width: '16px', height: '16px' }}
                      />
                      <span>TikTok</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px' }}>
                  <button type="submit" className="action-btn" style={{ padding: '12px 24px' }}>
                    Save Profile
                  </button>
                  {profileSavedFlash && (
                    <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600, animation: 'pulse 1.5s infinite' }}>
                      ✓ Profile settings saved successfully!
                    </span>
                  )}
                </div>
              </form>
            </div>

            {/* Premium Upgrade CTA Card */}
            <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'radial-gradient(ellipse at top right, rgba(139, 92, 246, 0.1), transparent)' }}>
              <div>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: '#c084fc' }}>🚀 Need Unlimited Summaries?</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                  Upgrade to **TreeMind Premium** to remove the monthly 20-video limit, enable Fine-Grained Study depth for longer videos, and gain faster GPU transcription access.
                </p>
              </div>

              <button 
                type="button" 
                className="action-btn"
                style={{
                  background: 'linear-gradient(90deg, #8b5cf6, #c084fc)',
                  border: 'none',
                  color: '#fff',
                  justifyContent: 'center',
                  padding: '14px',
                  fontWeight: 600
                }}
                onClick={() => {
                  const activePlatforms = Object.keys(profilePlatforms)
                    .filter(k => profilePlatforms[k])
                    .join(', ');
                  const mailtoUrl = `mailto:upgrade@treemind.ai?subject=Premium Upgrade Request - ${userId}&body=Hi TreeMind AI Team,%0A%0AI would like to upgrade my account (${userId}) to the Premium Tier for unlimited video ingestions.%0A%0AMy Details:%0A- Name: ${profileName || '(Not set)'}%0A- Email: ${profileEmail || '(Not set)'}%0A- Platforms: ${activePlatforms || '(None selected)'}%0A%0APlease contact me with upgrade instructions!`;
                  window.open(mailtoUrl, '_blank');
                }}
              >
                Send Upgrade Email Request
              </button>
            </div>

            {/* System Actions Area */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="action-btn"
                style={{
                  flex: 1,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  justifyContent: 'center',
                  padding: '12px'
                }}
                onClick={() => setShowSettings(true)}
              >
                <Settings size={16} style={{ marginRight: 8 }} />
                Server Settings
              </button>

              <button 
                className="action-btn"
                style={{
                  flex: 1,
                  background: 'rgba(239, 68, 68, 0.05)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  justifyContent: 'center',
                  padding: '12px'
                }}
                onClick={handleLogout}
              >
                <Lock size={16} style={{ marginRight: 8 }} />
                Lock Vault
              </button>
            </div>
          </section>
        )}

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
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Tab Navigation */}
                    <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '3px', marginBottom: '16px', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => setChatTab('details')}
                        className={`view-toggle-btn ${chatTab === 'details' ? 'active' : ''}`}
                        style={{ flex: 1, padding: '8px', border: 'none', fontSize: '13px', fontWeight: 600 }}
                      >
                        Video Details
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatTab('chat')}
                        className={`view-toggle-btn ${chatTab === 'chat' ? 'active' : ''}`}
                        style={{ flex: 1, padding: '8px', border: 'none', fontSize: '13px', fontWeight: 600 }}
                      >
                        Chat Bot
                      </button>
                    </div>

                    {chatTab === 'details' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                              <a href={selectedNote.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
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
                            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Folder Location:</p>
                            <code style={{ background: 'var(--bg-base)', padding: '4px 8px', borderRadius: '4px', display: 'block', wordBreak: 'break-all' }}>
                              {selectedNote.filePath}
                            </code>
                          </div>
                          
                          <button 
                            className="action-btn"
                            style={{
                              width: '100%',
                              marginTop: '20px',
                              background: 'var(--accent-glow)',
                              color: 'var(--accent-primary)',
                              border: '1px solid var(--accent-primary)',
                              justifyContent: 'center'
                            }}
                            onClick={() => setIsEditingMeta(true)}
                          >
                            ✏️ Edit Classification & Tags
                          </button>
                          <button 
                            className="action-btn"
                            style={{
                              width: '100%',
                              marginTop: '10px',
                              background: 'rgba(239, 68, 68, 0.08)',
                              color: '#ef4444',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              justifyContent: 'center'
                            }}
                            onClick={handleDeleteNote}
                            disabled={deletingNote}
                          >
                            🗑️ {deletingNote ? 'Deleting...' : 'Delete Note'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="chat-container">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Scope: Only this video overview
                          </span>
                          <button
                            onClick={handleResetChat}
                            className="chat-reset-btn"
                            style={{ border: 'none', margin: 0, padding: '4px 8px' }}
                          >
                            Reset Chat
                          </button>
                        </div>

                        <div className="chat-messages">
                          {chatMessages.length === 0 ? (
                            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                              <p style={{ fontSize: '13px' }}>Ask follow-up questions about this video summary.</p>
                            </div>
                          ) : (
                            chatMessages.map((msg, index) => (
                              <div key={index} className={`chat-message ${msg.role}`}>
                                <span style={{ fontWeight: 600, fontSize: '11px', marginBottom: '4px', opacity: 0.8 }}>
                                  {msg.role === 'user' ? 'You' : 'TreeMind AI'}
                                </span>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                              </div>
                            ))
                          )}
                          {sendingMessage && (
                            <div className="chat-message model" style={{ alignSelf: 'flex-start', padding: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <RefreshCw className="animate-spin" size={14} color="#8b5cf6" />
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Thinking...</span>
                            </div>
                          )}
                        </div>

                        <form onSubmit={handleSendMessage} className="chat-input-container">
                          <input
                            type="text"
                            className="chat-input"
                            placeholder="Ask a question about this video..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            disabled={sendingMessage}
                          />
                          <button
                            type="submit"
                            className="action-btn"
                            style={{ padding: '10px 18px' }}
                            disabled={sendingMessage || !chatInput.trim()}
                          >
                            Send
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
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

      {/* Mobile Bottom Navigation Bar */}
      <nav className="bottom-nav-bar">
        <button 
          className={`bottom-nav-item ${mobileTab === 'home' ? 'active' : ''}`}
          onClick={() => setMobileTab('home')}
        >
          <Home size={20} />
          <span>Home</span>
        </button>
        <button 
          className={`bottom-nav-item ${mobileTab === 'folders' ? 'active' : ''}`}
          onClick={() => setMobileTab('folders')}
        >
          <Folder size={20} />
          <span>Folders</span>
        </button>
        <button 
          className={`bottom-nav-item ${mobileTab === 'queue' ? 'active' : ''}`}
          onClick={() => setMobileTab('queue')}
        >
          <RefreshCw size={20} />
          <span>Queue</span>
        </button>
        <button 
          className={`bottom-nav-item ${mobileTab === 'profile' ? 'active' : ''}`}
          onClick={() => setMobileTab('profile')}
        >
          <User size={20} />
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}
