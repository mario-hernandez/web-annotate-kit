import {
  useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useReview } from './ReviewProvider';
import { useReviewTour } from './ReviewTour';
import type { ReviewComment } from './types';

/* ─── Router-agnostic current path hook ─────────────────────── */

function useDefaultPath(): string {
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onChange);
    // Patch pushState/replaceState so SPA navigations (react-router, next) propagate
    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;
    window.history.pushState = function patched(...args: Parameters<History['pushState']>) {
      origPush.apply(this, args);
      onChange();
    };
    window.history.replaceState = function patched(...args: Parameters<History['replaceState']>) {
      origReplace.apply(this, args);
      onChange();
    };
    return () => {
      window.removeEventListener('popstate', onChange);
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, []);
  return path;
}

/* ─── DOM context capture ───────────────────────────────────── */

function captureDomContext(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!el) return {};

  const tagName = el.tagName;
  const nearestText = (el.textContent?.trim() || '').slice(0, 120) || undefined;

  let section: string | undefined;
  let node: HTMLElement | null = el;
  while (node) {
    if (node.tagName === 'SECTION') {
      const h = node.querySelector('h1, h2, h3, h4');
      section = h?.textContent?.trim().slice(0, 100) || undefined;
      break;
    }
    node = node.parentElement;
  }

  const parts: string[] = [];
  let curr: HTMLElement | null = el;
  for (let i = 0; i < 4 && curr && curr !== document.body; i++) {
    let s = curr.tagName.toLowerCase();
    if (curr.id) s += `#${curr.id}`;
    else if (curr.className && typeof curr.className === 'string') {
      const cls = curr.className.split(/\s+/).filter((c) => !c.startsWith('__') && c.length < 30).slice(0, 2).join('.');
      if (cls) s += `.${cls}`;
    }
    parts.unshift(s);
    curr = curr.parentElement;
  }

  return { section, nearestText, selector: parts.join(' > ') || undefined, tagName };
}

/* ─── Pin ────────────────────────────────────────────────────── */

function Pin({
  comment, index, isActive, isEditing, editText, canEdit, resolvedPinOpacity,
  onEditTextChange, onSaveEdit, onClick, onEdit, onDelete, onCancelEdit, onResolve,
}: {
  comment: ReviewComment; index: number; isActive: boolean; isEditing: boolean;
  editText: string; onEditTextChange: (t: string) => void; onSaveEdit: () => void;
  onClick: () => void; onEdit: () => void; onDelete: () => void; onCancelEdit: () => void;
  onResolve: () => void; canEdit: boolean; resolvedPinOpacity: number;
}) {
  const showLeft = comment.x > 65;
  const popPos = showLeft ? { right: '2rem', left: 'auto' } : { left: '2rem', right: 'auto' };
  const color = comment.authorColor || '#6B7280';
  const isMine = canEdit;
  const dimmed = comment.resolved && !isActive;
  const wrapStyle: Record<string, string | number> = {
    position: 'absolute',
    left: `${comment.x}%`,
    top: `${comment.y}px`,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'auto',
    zIndex: isActive ? 9992 : 9991,
  };
  if (dimmed) {
    wrapStyle['--wak-pin-dim-opacity'] = String(resolvedPinOpacity);
  } else {
    wrapStyle.opacity = isMine ? 1 : 0.6;
  }

  return (
    <div
      className={`wak-pin-wrap ${dimmed ? 'wak-pin-dimmed' : ''}`}
      style={wrapStyle}
    >
      <button
        onClick={onClick}
        className={`wak-pin-btn ${isMine ? 'wak-pin-mine' : 'wak-pin-others'} ${dimmed ? 'wak-pin-btn-dimmed' : ''}`}
        style={{
          backgroundColor: isMine ? color : 'transparent',
          border: isMine ? 'none' : `2px dashed ${color}`,
          transform: isActive ? 'scale(1.2)' : undefined,
        }}
        title={`${comment.author}: ${comment.text.slice(0, 60)}`}
      >
        {isMine ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'white' }}>{index}</span>
        ) : (
          <span style={{ fontSize: 8, fontWeight: 700, color }}>{comment.author[0]}</span>
        )}
        {comment.resolved && <span className="wak-pin-check">✓</span>}
      </button>

      {isActive && !isEditing && (
        <div className={`wak-popover ${isMine ? 'wak-popover-mine' : 'wak-popover-others'}`} style={popPos}>
          <div className="wak-popover-header">
            <div className="wak-popover-author">
              {!isMine && <div className="wak-avatar-sm" style={{ backgroundColor: color }}>{comment.author[0]}</div>}
              <div>
                <span className="wak-author-name" style={isMine ? { color } : undefined}>{comment.author}</span>
                <span className="wak-date">
                  {new Date(comment.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
            <button onClick={onClick} className="wak-close-btn" aria-label="Close">
              <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="wak-comment-text">{comment.text}</p>
          {comment.section && <p className="wak-meta">Section: <em>{comment.section}</em></p>}
          {comment.updatedAt && <p className="wak-meta wak-italic">edited</p>}
          {comment.screenshotUrl && (
            <a href={comment.screenshotUrl} target="_blank" rel="noopener noreferrer" className="wak-thumb-popover-link">
              <img src={comment.screenshotUrl} alt="Screenshot" className="wak-thumb-popover" />
            </a>
          )}
          {isMine && (
            <div className="wak-actions">
              <button onClick={onResolve} className={`wak-btn-text ${comment.resolved ? 'wak-btn-resolved' : ''}`}>
                {comment.resolved ? '✓ Resolved' : 'Resolve'}
              </button>
              <button onClick={onEdit} className="wak-btn-text">Edit</button>
              <button onClick={onDelete} className="wak-btn-text wak-btn-danger">Delete</button>
            </div>
          )}
        </div>
      )}

      {isActive && isEditing && (
        <div className="wak-popover wak-popover-mine wak-popover-edit" style={popPos}>
          <textarea
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            className="wak-textarea"
            rows={3}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSaveEdit(); }}
          />
          <div className="wak-actions wak-actions-right">
            <button onClick={onCancelEdit} className="wak-btn-ghost">Cancel</button>
            <button onClick={onSaveEdit} disabled={!editText.trim()} className="wak-btn-primary">Save</button>
          </div>
          <p className="wak-hint">⌘+Enter to save</p>
        </div>
      )}
    </div>
  );
}

/* ─── Overlay ───────────────────────────────────────────────── */

export interface ReviewOverlayProps {
  /**
   * Override the current page path. If not provided, the overlay listens to
   * popstate + patches history.pushState/replaceState to track SPA navigations.
   * Pass your router's pathname (e.g. `useLocation().pathname`) for perfect integration.
   */
  currentPath?: string;
  /** Path of the dashboard page. Default: "/review". */
  dashboardPath?: string;
  /**
   * Paths (or path prefixes) where pins must NOT be rendered — typically the dashboard itself.
   * Default: [dashboardPath].
   */
  hidePinsOn?: string[];
  /** Custom Link renderer (e.g. Next's Link or react-router's Link). Defaults to <a>. */
  LinkComponent?: (props: { to: string; onClick?: () => void; className?: string; children: ReactNode }) => ReactNode;
  /** Accent color. Default: "#305B91". */
  accentColor?: string;
}

export default function ReviewOverlay({
  currentPath,
  dashboardPath = '/review',
  hidePinsOn,
  LinkComponent,
  accentColor = '#305B91',
}: ReviewOverlayProps = {}) {
  const {
    user, comments, addComment, updateComment, deleteComment, resolveComment,
    exportComments, exportCompact, logout, config,
  } = useReview();
  const { resolvedOpacity, resolvedPinOpacity } = config;

  const defaultPath = useDefaultPath();
  const pathname = currentPath ?? defaultPath;
  const { hasSeen, startTour } = useReviewTour();

  const hideOn = hidePinsOn ?? [dashboardPath];
  const isDashboard = hideOn.some((p) => pathname === p || pathname.startsWith(p + '/'));

  const [addMode, setAddMode] = useState(false);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [newPin, setNewPin] = useState<{ x: number; y: number; section?: string; nearestText?: string; selector?: string; tagName?: string } | null>(null);
  const [newText, setNewText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pageComments = comments.filter((c) => c.page === pathname);

  useEffect(() => {
    setAddMode(false); setActivePin(null); setNewPin(null); setEditId(null); setMenuOpen(false);
  }, [pathname]);

  useEffect(() => { if (!hasSeen && user && !isDashboard) startTour(); }, [hasSeen, user, isDashboard, startTour]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAddMode(false); setNewPin(null); setActivePin(null); setEditId(null); setMenuOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => { if (newPin) setTimeout(() => textareaRef.current?.focus(), 50); }, [newPin]);

  const handleOverlayClick = useCallback((e: ReactMouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const overlay = e.currentTarget as HTMLElement;
    overlay.style.pointerEvents = 'none';
    overlay.style.visibility = 'hidden';
    const ctx = captureDomContext(e.clientX, e.clientY);
    overlay.style.pointerEvents = '';
    overlay.style.visibility = '';
    setNewPin({ x: (e.clientX / window.innerWidth) * 100, y: e.pageY, ...ctx });
    setAddMode(false); setNewText('');
  }, []);

  const handleSaveNew = useCallback(() => {
    if (!newPin || !newText.trim()) return;
    addComment({
      page: pathname, x: newPin.x, y: newPin.y, text: newText.trim(),
      section: newPin.section, nearestText: newPin.nearestText,
      selector: newPin.selector, tagName: newPin.tagName,
    });
    setNewPin(null); setNewText('');
  }, [newPin, newText, addComment, pathname]);

  const handleSaveEdit = useCallback(() => {
    if (!editId || !editText.trim()) return;
    updateComment(editId, editText.trim());
    setEditId(null); setEditText(''); setActivePin(null);
  }, [editId, editText, updateComment]);

  const handleExport = useCallback((compact: boolean) => {
    const content = compact ? exportCompact() : exportComments();
    const ext = compact ? 'txt' : 'json';
    const blob = new Blob([content], { type: compact ? 'text/plain' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `review-${new Date().toISOString().slice(0, 10)}.${ext}`; a.click();
    URL.revokeObjectURL(url); setMenuOpen(false);
  }, [exportComments, exportCompact]);

  const Link = LinkComponent ?? (({ to, onClick, className, children }: { to: string; onClick?: () => void; className?: string; children: ReactNode }) => (
    <a href={to} onClick={onClick} className={className}>{children}</a>
  ));

  if (!user) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-review-ui className="wak-root">
      {addMode && (
        <div className="wak-add-overlay" onClick={handleOverlayClick}>
          <div className="wak-add-banner" style={{ backgroundColor: accentColor }}>
            <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Click where you want to comment · Esc to cancel
          </div>
        </div>
      )}

      {!isDashboard && (
        <div className="wak-pins-layer">
          {pageComments.map((c, i) => (
            <Pin
              key={c.id}
              comment={c}
              index={i + 1}
              isActive={activePin === c.id}
              isEditing={editId === c.id}
              editText={editText}
              onEditTextChange={setEditText}
              onSaveEdit={handleSaveEdit}
              onClick={() => { setActivePin(activePin === c.id ? null : c.id); setEditId(null); }}
              onEdit={() => { setEditId(c.id); setEditText(c.text); }}
              onDelete={() => { deleteComment(c.id); setActivePin(null); }}
              onCancelEdit={() => { setEditId(null); setEditText(''); }}
              onResolve={() => resolveComment(c.id)}
              canEdit={c.author === user.name || user.role === 'admin'}
              resolvedPinOpacity={resolvedPinOpacity}
            />
          ))}

          {newPin && (
            <div style={{
              position: 'absolute',
              left: `${newPin.x}%`,
              top: `${newPin.y}px`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              zIndex: 9994,
            }}>
              <div className="wak-new-pin" style={{ backgroundColor: user.color }}>
                <span>+</span>
              </div>
              <div className="wak-popover wak-popover-mine" style={newPin.x > 65 ? { right: '2rem', left: 'auto' } : { left: '2rem', right: 'auto' }}>
                <p className="wak-author-name" style={{ color: user.color }}>{user.name}</p>
                {newPin.section && <p className="wak-meta">Section: {newPin.section}</p>}
                <textarea
                  ref={textareaRef}
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  placeholder="Write your comment..."
                  rows={3}
                  className="wak-textarea"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveNew();
                    if (e.key === 'Escape') { setNewPin(null); setNewText(''); }
                  }}
                />
                <div className="wak-actions wak-actions-between">
                  <p className="wak-hint">⌘+Enter</p>
                  <div>
                    <button onClick={() => { setNewPin(null); setNewText(''); }} className="wak-btn-ghost">Cancel</button>
                    <button onClick={handleSaveNew} disabled={!newText.trim()} className="wak-btn-primary" style={{ backgroundColor: accentColor }}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Side panel */}
      {panelOpen && !isDashboard && (
        <div className="wak-side-panel">
          <div className="wak-panel-header">
            <div>
              <p className="wak-panel-title">Comments</p>
              <p className="wak-panel-sub">{pageComments.length} on this page · {pageComments.filter((c) => !c.resolved).length} open</p>
            </div>
            <div className="wak-panel-actions">
              <button
                onClick={async () => { await navigator.clipboard.writeText(exportCompact()); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="wak-btn-outline-xs"
              >{copied ? '✓ Copied' : 'Copy .txt'}</button>
              <button
                onClick={async () => { await navigator.clipboard.writeText(exportComments()); setCopiedJson(true); setTimeout(() => setCopiedJson(false), 2000); }}
                className="wak-btn-outline-xs"
              >{copiedJson ? '✓ Copied' : 'Copy .json'}</button>
              <button onClick={() => handleExport(false)} className="wak-btn-outline-xs">Download</button>
              <button onClick={() => setPanelOpen(false)} className="wak-close-btn" aria-label="Close">
                <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {pageComments.some((c) => c.resolved) && (
            <button onClick={() => setShowResolved(!showResolved)} className="wak-resolved-toggle">
              <span className={`wak-checkbox ${showResolved ? 'wak-checked' : ''}`} style={showResolved ? { backgroundColor: accentColor } : undefined}>
                {showResolved && <svg className="wak-icon-xs" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </span>
              Show resolved ({pageComments.filter((c) => c.resolved).length})
            </button>
          )}

          <div className="wak-panel-list">
            {pageComments.filter((c) => showResolved || !c.resolved).length === 0 ? (
              <p className="wak-empty">{pageComments.length === 0 ? 'No comments on this page' : 'All comments resolved'}</p>
            ) : (
              pageComments.filter((c) => showResolved || !c.resolved).map((c, i) => {
                const clr = c.authorColor || '#6B7280';
                const mine = c.author === user.name || user.role === 'admin';
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActivePin(c.id);
                      window.scrollTo({ top: c.y - window.innerHeight / 3, behavior: 'smooth' });
                    }}
                    className={`wak-panel-item ${mine ? 'wak-mine' : 'wak-others'} ${activePin === c.id ? 'wak-active' : ''} ${c.resolved ? 'wak-resolved' : ''}`}
                  >
                    <div className="wak-panel-avatar" style={{ backgroundColor: clr }}>
                      {mine ? i + 1 : c.author[0]}
                    </div>
                    <div className="wak-panel-body">
                      <div className="wak-panel-row">
                        <span className="wak-author-name">{c.author}</span>
                        {c.resolved && <span className="wak-resolved-tag">✓</span>}
                      </div>
                      <p className="wak-comment-preview">{c.text}</p>
                      {mine && c.section && <p className="wak-section">{c.section}</p>}
                    </div>
                    {c.screenshotUrl && (
                      <img src={c.screenshotUrl} alt="" className="wak-panel-thumb" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="wak-toolbar">
        {menuOpen && (
          <div className="wak-menu">
            <Link to={dashboardPath} onClick={() => setMenuOpen(false)} className="wak-menu-item">Dashboard</Link>
            <button onClick={() => { setMenuOpen(false); startTour(); }} className="wak-menu-item">Tutorial</button>
            <button onClick={() => handleExport(true)} className="wak-menu-item">Export .txt</button>
            <button onClick={() => handleExport(false)} className="wak-menu-item">Export .json</button>
            <div className="wak-menu-sep" />
            <button onClick={() => { logout(); setMenuOpen(false); }} className="wak-menu-item wak-menu-danger">Sign out</button>
          </div>
        )}

        {!isDashboard && (
          <button
            data-tour="btn-panel"
            onClick={() => { setPanelOpen(!panelOpen); setMenuOpen(false); }}
            className={`wak-btn-pill ${panelOpen ? 'wak-btn-active' : ''}`}
            title="View comments"
            style={panelOpen ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
          >
            <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <span>{pageComments.length}</span>
          </button>
        )}

        <button data-tour="btn-user" onClick={() => setMenuOpen(!menuOpen)} className="wak-btn-user">
          <span style={{ color: user.color }}>{user.name[0]}</span>
        </button>

        {!isDashboard && (
          <button
            data-tour="btn-add"
            onClick={() => { setAddMode(!addMode); setMenuOpen(false); setActivePin(null); setNewPin(null); }}
            className={`wak-btn-add ${addMode ? 'wak-btn-active' : ''}`}
            title="Add comment"
            style={addMode ? { backgroundColor: accentColor, color: 'white' } : undefined}
          >
            <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          </button>
        )}
      </div>

      <OverlayStyles accentColor={accentColor} resolvedOpacity={resolvedOpacity} />
    </div>,
    document.body,
  );
}

/* ─── Scoped styles ─────────────────────────────────────────── */

function OverlayStyles({ accentColor, resolvedOpacity }: { accentColor: string; resolvedOpacity: number }) {
  return (
    <style>{`
      .wak-root * { box-sizing: border-box; }
      .wak-add-overlay { position: fixed; inset: 0; z-index: 9993; cursor: crosshair; }
      .wak-add-banner { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; color: white; font-size: 14px; font-weight: 500; pointer-events: none; }
      .wak-pins-layer { position: absolute; top: 0; left: 0; width: 100%; height: 0; overflow: visible; pointer-events: none; z-index: 9990; }
      .wak-pin-wrap { transition: opacity 300ms ease-out, filter 300ms ease-out; }
      .wak-pin-dimmed { opacity: var(--wak-pin-dim-opacity, 0.28); filter: saturate(0.4); }
      .wak-pin-dimmed:hover { opacity: 1; filter: saturate(1); }
      .wak-pin-btn { display: flex; align-items: center; justify-content: center; border-radius: 9999px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transition: box-shadow 300ms ease-out, transform 0.15s; cursor: pointer; border: none; }
      .wak-pin-btn-dimmed { box-shadow: 0 0 0 1px rgba(0,0,0,0.08); }
      .wak-pin-dimmed:hover .wak-pin-btn-dimmed { box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
      .wak-pin-mine { height: 28px; width: 28px; }
      .wak-pin-others { height: 20px; width: 20px; }
      .wak-pin-btn:hover { transform: scale(1.1); }
      .wak-pin-check { position: absolute; bottom: -2px; right: -2px; height: 12px; width: 12px; display: flex; align-items: center; justify-content: center; border-radius: 9999px; background: white; font-size: 8px; }
      .wak-popover { position: absolute; top: 0; border-radius: 12px; padding: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: wak-fade 0.15s ease-out; }
      .wak-popover-mine { width: 288px; border: 1px solid #e5e7eb; background: white; }
      .wak-popover-others { width: 256px; border: 1px solid #f3f4f6; background: #f9fafb; }
      .wak-popover-edit { background: white; }
      .wak-popover-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .wak-popover-author { display: flex; align-items: center; gap: 8px; }
      .wak-avatar-sm { display: flex; height: 20px; width: 20px; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 9999px; font-size: 9px; font-weight: 700; color: white; }
      .wak-author-name { font-size: 12px; font-weight: 600; }
      .wak-date { margin-left: 8px; font-size: 10px; color: #9ca3af; }
      .wak-close-btn { background: transparent; border: none; flex-shrink: 0; color: #d1d5db; cursor: pointer; }
      .wak-close-btn:hover { color: #6b7280; }
      .wak-icon-sm { height: 16px; width: 16px; }
      .wak-icon-xs { height: 12px; width: 12px; }
      .wak-comment-text { margin: 8px 0 0; white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: #374151; }
      .wak-meta { margin: 4px 0 0; font-size: 10px; color: #9ca3af; }
      .wak-italic { font-style: italic; }
      .wak-thumb-popover-link { display: block; margin-top: 10px; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb; }
      .wak-thumb-popover { display: block; width: 100%; height: 96px; object-fit: cover; object-position: top; transition: transform 0.2s; }
      .wak-thumb-popover-link:hover .wak-thumb-popover { transform: scale(1.02); }
      .wak-actions { display: flex; gap: 12px; border-top: 1px solid #f3f4f6; padding-top: 12px; margin-top: 12px; }
      .wak-actions-right { justify-content: flex-end; border-top: none; }
      .wak-actions-between { justify-content: space-between; align-items: center; border-top: none; margin-top: 12px; padding-top: 0; }
      .wak-btn-text { background: transparent; border: none; font-size: 12px; font-weight: 500; color: #6b7280; cursor: pointer; }
      .wak-btn-text:hover { color: ${accentColor}; }
      .wak-btn-resolved { color: #059669 !important; }
      .wak-btn-danger { color: #fca5a5 !important; }
      .wak-btn-danger:hover { color: #dc2626 !important; }
      .wak-textarea { width: 100%; resize: none; border-radius: 8px; border: 1px solid #e5e7eb; padding: 12px; font-size: 13px; line-height: 1.5; outline: none; font-family: inherit; }
      .wak-textarea:focus { border-color: ${accentColor}; }
      .wak-btn-ghost { background: transparent; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #6b7280; cursor: pointer; }
      .wak-btn-ghost:hover { background: #f3f4f6; }
      .wak-btn-primary { background: ${accentColor}; color: white; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; }
      .wak-btn-primary:disabled { opacity: 0.4; }
      .wak-hint { font-size: 10px; color: #9ca3af; }
      .wak-new-pin { display: flex; align-items: center; justify-content: center; height: 28px; width: 28px; border-radius: 9999px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); ring: 2px solid white; animation: wak-scale 0.2s ease-out; color: white; font-size: 12px; font-weight: 700; }

      .wak-side-panel { position: fixed; right: 0; top: 0; z-index: 9994; display: flex; flex-direction: column; height: 100%; width: 320px; background: rgba(255,255,255,0.95); backdrop-filter: blur(8px); border-left: 1px solid #e5e7eb; box-shadow: -10px 0 30px rgba(0,0,0,0.15); animation: wak-slide 0.2s ease-out; }
      .wak-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
      .wak-panel-title { font-size: 14px; font-weight: 600; color: #111827; margin: 0; }
      .wak-panel-sub { font-size: 11px; color: #9ca3af; margin: 2px 0 0; }
      .wak-panel-actions { display: flex; align-items: center; gap: 4px; }
      .wak-btn-outline-xs { border-radius: 6px; border: 1px solid #e5e7eb; padding: 4px 8px; font-size: 10px; font-weight: 500; color: #6b7280; background: white; cursor: pointer; }
      .wak-btn-outline-xs:hover { background: #f3f4f6; color: #374151; }
      .wak-resolved-toggle { display: flex; width: 100%; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #f3f4f6; text-align: left; font-size: 11px; color: #9ca3af; background: transparent; border-left: none; border-right: none; border-top: none; cursor: pointer; }
      .wak-resolved-toggle:hover { background: #f9fafb; }
      .wak-checkbox { display: inline-flex; height: 12px; width: 12px; align-items: center; justify-content: center; border-radius: 3px; border: 1px solid #d1d5db; }
      .wak-checked { border-color: ${accentColor}; }
      .wak-panel-list { flex: 1; overflow-y: auto; }
      .wak-empty { padding: 32px 16px; text-align: center; font-size: 13px; color: #9ca3af; }
      .wak-panel-item { display: flex; width: 100%; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f9fafb; text-align: left; background: transparent; border-left: none; border-right: none; border-top: none; cursor: pointer; }
      .wak-panel-item:hover { background: #f9fafb; }
      .wak-panel-item.wak-others { background: rgba(249,250,251,0.5); padding-top: 8px; padding-bottom: 8px; }
      .wak-panel-item.wak-active { background: ${accentColor}10; }
      .wak-panel-item { transition: opacity 300ms ease-out, filter 300ms ease-out; }
      .wak-panel-item.wak-resolved { opacity: ${resolvedOpacity}; }
      .wak-panel-item.wak-resolved .wak-author-name,
      .wak-panel-item.wak-resolved .wak-comment-preview { text-decoration: line-through; text-decoration-color: rgba(0,0,0,0.25); text-decoration-thickness: 1px; }
      .wak-panel-item.wak-resolved .wak-panel-thumb { filter: grayscale(0.6) saturate(0.5); }
      .wak-panel-avatar { display: flex; height: 24px; width: 24px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 9999px; font-size: 10px; font-weight: 700; color: white; margin-top: 2px; }
      .wak-panel-body { flex: 1; min-width: 0; }
      .wak-panel-row { display: flex; align-items: center; gap: 6px; }
      .wak-resolved-tag { border-radius: 4px; background: #d1fae5; padding: 2px 4px; font-size: 9px; font-weight: 500; color: #065f46; }
      .wak-comment-preview { margin: 2px 0 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 12px; line-height: 1.5; color: #4b5563; }
      .wak-section { margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: #9ca3af; }
      .wak-panel-thumb { flex-shrink: 0; width: 56px; height: 42px; border-radius: 4px; object-fit: cover; object-position: top; border: 1px solid #e5e7eb; margin-top: 2px; }

      .wak-toolbar { position: fixed; bottom: 20px; right: 20px; z-index: 9995; display: flex; align-items: center; gap: 8px; }
      .wak-menu { display: flex; align-items: center; gap: 4px; border-radius: 9999px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.95); backdrop-filter: blur(8px); padding: 4px 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); animation: wak-fade 0.12s ease-out; }
      .wak-menu-item { display: inline-flex; border-radius: 9999px; padding: 6px 12px; font-size: 12px; font-weight: 500; color: #4b5563; background: transparent; border: none; cursor: pointer; text-decoration: none; }
      .wak-menu-item:hover { background: #f3f4f6; }
      .wak-menu-danger { color: #ef4444; }
      .wak-menu-danger:hover { background: #fef2f2; }
      .wak-menu-sep { margin: 0 4px; height: 16px; width: 1px; background: #e5e7eb; }
      .wak-btn-pill, .wak-btn-user, .wak-btn-add { display: flex; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid #e5e7eb; background: white; box-shadow: 0 10px 20px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.15s; }
      .wak-btn-pill { height: 40px; padding: 0 12px; gap: 6px; color: #6b7280; font-size: 12px; font-weight: 500; }
      .wak-btn-user { height: 40px; width: 40px; }
      .wak-btn-user span { font-size: 14px; font-weight: 700; }
      .wak-btn-add { height: 40px; width: 40px; color: #6b7280; }
      .wak-btn-pill:hover, .wak-btn-user:hover, .wak-btn-add:hover { transform: scale(1.05); }

      @keyframes wak-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes wak-scale { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
      @keyframes wak-slide { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }

      .wak-tour-popover .driver-popover { border-radius: 16px !important; padding: 24px !important; max-width: 360px !important; }
      .wak-tour-popover .driver-popover-title { font-family: 'Cormorant Garamond', Georgia, serif !important; font-size: 20px !important; font-weight: 500 !important; color: #1a1a1a !important; }
      .wak-tour-popover .driver-popover-description { font-size: 14px !important; line-height: 1.6 !important; color: #636363 !important; }
      .wak-tour-popover .driver-popover-next-btn, .wak-tour-popover .driver-popover-close-btn-custom { background: ${accentColor} !important; color: white !important; border-radius: 8px !important; font-size: 13px !important; padding: 6px 16px !important; border: none !important; text-shadow: none !important; }
      .wak-tour-popover .driver-popover-prev-btn { border-radius: 8px !important; font-size: 13px !important; padding: 6px 16px !important; color: #636363 !important; }
      .wak-tour-popover .driver-popover-progress-text { font-size: 11px !important; color: #999 !important; }
    `}</style>
  );
}
