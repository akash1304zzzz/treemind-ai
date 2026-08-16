import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ── Lightweight toast + confirm system (no external dependencies) ──

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);
  const [confirmState, setConfirmState] = useState(null); // { message, onConfirm, danger }

  const toast = useCallback((message, type = 'info') => {
    const id = ++idCounter.current;
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, type === 'error' ? 6000 : 3500);
  }, []);

  const confirmDialog = useCallback((message, { onConfirm, danger = false, confirmLabel = 'Confirm' } = {}) => {
    setConfirmState({ message, onConfirm, danger, confirmLabel });
  }, []);

  const closeConfirm = useCallback((result) => {
    setConfirmState(current => {
      if (result && current?.onConfirm) current.onConfirm();
      return null;
    });
  }, []);

  return (
    <UIContext.Provider value={{ toast, confirmDialog }}>
      {children}

      {/* Toast stack */}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(360px, calc(100vw - 40px))'
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'error' ? '#7f1d1d' : t.type === 'success' ? '#14532d' : '#0f172a',
            color: '#fff', padding: '12px 16px', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: 13.5, lineHeight: 1.45,
            display: 'flex', alignItems: 'flex-start', gap: 8,
            animation: 'toastIn 0.25s cubic-bezier(0.16,1,0.3,1)'
          }}>
            <span style={{ fontSize: 15, lineHeight: '20px' }}>
              {t.type === 'error' ? '⚠️' : t.type === 'success' ? '✅' : 'ℹ️'}
            </span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <div className="modal-overlay" onClick={() => closeConfirm(false)}
          style={{ zIndex: 10001 }}>
          <div className="glass-panel" onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-elevated)', borderRadius: 14, padding: '24px',
              width: 'min(400px, calc(100vw - 40px))', boxShadow: 'var(--shadow-lg)',
              display: 'flex', flexDirection: 'column', gap: 16
            }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {confirmState.message}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="action-btn" onClick={() => closeConfirm(false)}
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                Cancel
              </button>
              <button className="action-btn" onClick={() => closeConfirm(true)}
                style={{
                  background: confirmState.danger ? '#dc2626' : 'var(--accent-primary)', color: '#fff',
                  border: 'none'
                }}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) {
    // Fallbacks so components render even outside the provider (e.g. tests)
    return {
      toast: (msg) => console.log('[toast]', msg),
      confirmDialog: (msg, { onConfirm } = {}) => { if (window.confirm(msg)) onConfirm && onConfirm(); }
    };
  }
  return ctx;
}

// Console/terminal box that auto-scrolls to the newest line
export function AutoScrollConsole({ text, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre ref={ref} style={{
      background: '#0b1120', color: '#86efac', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12, lineHeight: 1.6, padding: 14, borderRadius: 10, margin: 0,
      overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      border: '1px solid rgba(255,255,255,0.06)', ...style
    }}>{text}</pre>
  );
}
