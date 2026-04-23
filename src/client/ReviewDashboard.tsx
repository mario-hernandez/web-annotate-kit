import { useState, type ReactNode } from 'react';
import { useReview } from './ReviewProvider';

export interface ReviewDashboardProps {
  /** Custom Link renderer (e.g. Next's Link or react-router's Link). Defaults to <a>. */
  LinkComponent?: (props: { to: string; className?: string; title?: string; children: ReactNode }) => ReactNode;
  /** Home path (back button). Default: "/". */
  homePath?: string;
  /** Accent color. Default: "#305B91". */
  accentColor?: string;
  /** Dashboard title. Default: "Review". */
  title?: string;
}

export default function ReviewDashboard({
  LinkComponent,
  homePath = '/',
  accentColor = '#305B91',
  title = 'Review',
}: ReviewDashboardProps = {}) {
  const { user, comments, deleteComment, resolveComment, exportComments, exportCompact } = useReview();
  const [filterAuthor, setFilterAuthor] = useState('all');
  const [filterPage, setFilterPage] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterScope, setFilterScope] = useState<'mine' | 'team' | 'all'>('all');
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const visible = comments;

  const pages = [...new Set(visible.map((c) => c.page))].sort();
  const authors = [...new Set(visible.map((c) => c.author))].sort();

  const myCount = visible.filter((c) => c.author === user.name).length;
  const teamCount = visible.filter((c) => c.author !== user.name).length;

  const filtered = visible
    .filter((c) => {
      if (filterScope === 'mine' && c.author !== user.name) return false;
      if (filterScope === 'team' && c.author === user.name) return false;
      if (filterAuthor !== 'all' && c.author !== filterAuthor) return false;
      if (filterPage !== 'all' && c.page !== filterPage) return false;
      if (filterStatus === 'open' && c.resolved) return false;
      if (filterStatus === 'resolved' && !c.resolved) return false;
      return true;
    })
    .sort((a, b) => a.page.localeCompare(b.page) || a.y - b.y);

  const openCount = visible.filter((c) => !c.resolved).length;
  const resolvedCount = visible.filter((c) => c.resolved).length;

  const handleExport = (compact: boolean) => {
    const content = compact ? exportCompact() : exportComments();
    const ext = compact ? 'txt' : 'json';
    const blob = new Blob([content], { type: compact ? 'text/plain' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `review-${new Date().toISOString().slice(0, 10)}.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCompact = async () => {
    await navigator.clipboard.writeText(exportCompact());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const Link = LinkComponent ?? (({ to, className, title, children }: { to: string; className?: string; title?: string; children: ReactNode }) => (
    <a href={to} className={className} title={title}>{children}</a>
  ));

  return (
    <div className="wak-dash-root">
      <div className="wak-dash-header">
        <div className="wak-dash-wrap">
          <div className="wak-dash-title-row">
            <Link to={homePath} className="wak-dash-back" title="Back">
              <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="wak-dash-h1">{title} — {user.name}</h1>
              <p className="wak-dash-sub">
                {visible.length} comments · {pages.length} pages
                {authors.length > 1 && ` · ${authors.length} reviewers`}
              </p>
            </div>
          </div>
          <div className="wak-dash-actions">
            {isAdmin && (
              <button onClick={handleCopyCompact} className="wak-dash-btn-outline">
                {copied ? '✓ Copied' : 'Copy for AI'}
              </button>
            )}
            <button onClick={() => handleExport(true)} className="wak-dash-btn-outline">.txt</button>
            <button onClick={() => handleExport(false)} className="wak-dash-btn-primary" style={{ backgroundColor: accentColor }}>.json</button>
          </div>
        </div>
      </div>

      <div className="wak-dash-wrap wak-dash-main">
        <div className="wak-dash-stats">
          <div className="wak-stat-card"><p className="wak-stat-value">{visible.length}</p><p className="wak-stat-label">Total</p></div>
          <div className="wak-stat-card"><p className="wak-stat-value wak-stat-amber">{openCount}</p><p className="wak-stat-label">Open</p></div>
          <div className="wak-stat-card"><p className="wak-stat-value wak-stat-green">{resolvedCount}</p><p className="wak-stat-label">Resolved</p></div>
          <div className="wak-stat-card"><p className="wak-stat-value" style={{ color: user.color }}>{myCount}</p><p className="wak-stat-label">Mine</p></div>
        </div>

        <div className="wak-dash-filters">
          <div className="wak-scope-tabs">
            <button onClick={() => setFilterScope('all')} className={`wak-tab ${filterScope === 'all' ? 'wak-tab-active' : ''}`} style={filterScope === 'all' ? { backgroundColor: accentColor } : undefined}>All ({visible.length})</button>
            <button onClick={() => setFilterScope('mine')} className={`wak-tab ${filterScope === 'mine' ? 'wak-tab-active' : ''}`} style={filterScope === 'mine' ? { backgroundColor: accentColor } : undefined}>Mine ({myCount})</button>
            {teamCount > 0 && (
              <button onClick={() => setFilterScope('team')} className={`wak-tab ${filterScope === 'team' ? 'wak-tab-active' : ''}`} style={filterScope === 'team' ? { backgroundColor: accentColor } : undefined}>Team ({teamCount})</button>
            )}
          </div>
          <div className="wak-sep" />
          {authors.length > 1 && (
            <select value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)} className="wak-select">
              <option value="all">All reviewers</option>
              {authors.map((a) => <option key={a} value={a}>{a}{a === user.name ? ' (you)' : ''}</option>)}
            </select>
          )}
          <select value={filterPage} onChange={(e) => setFilterPage(e.target.value)} className="wak-select">
            <option value="all">All pages</option>
            {pages.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'open' | 'resolved')} className="wak-select">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <div className="wak-dash-list">
          {filtered.map((c) => {
            const mine = c.author === user.name || isAdmin;
            return (
              <div key={c.id} className={`wak-dash-item ${c.resolved ? 'wak-resolved' : mine ? 'wak-mine' : 'wak-others'}`}>
                <div className="wak-dash-item-header">
                  <div className="wak-dash-item-author">
                    <div className={`wak-avatar ${mine ? '' : 'wak-avatar-sm'}`} style={{ backgroundColor: c.authorColor || '#6B7280' }}>
                      {c.author[0]?.toUpperCase()}
                    </div>
                    <div className="wak-dash-item-meta">
                      <span className={`wak-author-name ${mine ? '' : 'wak-small'}`}>{c.author}</span>
                      <span className="wak-dot">·</span>
                      <Link to={c.page} className={`wak-page-link ${mine ? '' : 'wak-small'}`}>{c.page}</Link>
                      <span className="wak-dot">·</span>
                      <span className="wak-date">{fmtDate(c.createdAt)}</span>
                    </div>
                  </div>
                  <div className="wak-dash-item-actions">
                    {mine ? (
                      <>
                        <button onClick={() => resolveComment(c.id)} className={`wak-btn-pill-sm ${c.resolved ? 'wak-done' : ''}`}>
                          {c.resolved ? '✓ Resolved' : 'Resolve'}
                        </button>
                        <button onClick={() => deleteComment(c.id)} className="wak-btn-pill-sm wak-btn-danger">Delete</button>
                      </>
                    ) : c.resolved && <span className="wak-resolved-tag">✓ Resolved</span>}
                  </div>
                </div>
                <div className="wak-dash-item-body">
                  <p className={`wak-dash-text ${mine ? '' : 'wak-small'}`}>{c.text}</p>
                  {c.screenshotUrl && (
                    <a href={c.screenshotUrl} target="_blank" rel="noopener noreferrer" className="wak-thumb-link">
                      <img src={c.screenshotUrl} alt="Capture" className={`wak-thumb ${mine ? '' : 'wak-thumb-sm'}`} />
                    </a>
                  )}
                </div>
                {mine && (c.section || c.nearestText || c.selector) && (
                  <div className="wak-dash-meta">
                    {c.section && <p><strong>Section:</strong> {c.section}</p>}
                    {c.nearestText && <p><strong>Near:</strong> {c.nearestText}</p>}
                    {c.selector && <p className="wak-mono">{c.tagName && `<${c.tagName.toLowerCase()}>`} {c.selector}</p>}
                  </div>
                )}
                {c.updatedAt && <p className="wak-updated">Edited {fmtDate(c.updatedAt)}</p>}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="wak-dash-empty">
              <p>{visible.length === 0 ? 'No comments yet.' : 'No comments match these filters.'}</p>
            </div>
          )}
        </div>
      </div>

      <DashboardStyles accentColor={accentColor} />
    </div>
  );
}

function DashboardStyles({ accentColor }: { accentColor: string }) {
  return (
    <style>{`
      .wak-dash-root { min-height: 100vh; background: #f9fafb; font-family: system-ui, -apple-system, sans-serif; }
      .wak-dash-header { border-bottom: 1px solid #e5e7eb; background: white; }
      .wak-dash-wrap { max-width: 1152px; margin: 0 auto; padding: 16px 24px; }
      .wak-dash-main { padding-top: 32px; padding-bottom: 32px; }
      .wak-dash-title-row { display: flex; align-items: center; gap: 16px; }
      .wak-dash-back { display: inline-flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 8px; color: #9ca3af; text-decoration: none; }
      .wak-dash-back:hover { background: #f3f4f6; color: #6b7280; }
      .wak-dash-h1 { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
      .wak-dash-sub { font-size: 12px; color: #6b7280; margin: 2px 0 0; }
      .wak-dash-header .wak-dash-wrap { display: flex; align-items: center; justify-content: space-between; }
      .wak-dash-actions { display: flex; align-items: center; gap: 8px; }
      .wak-dash-btn-outline, .wak-dash-btn-primary { border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; }
      .wak-dash-btn-outline { border: 1px solid #e5e7eb; color: #374151; background: white; }
      .wak-dash-btn-outline:hover { background: #f9fafb; }
      .wak-dash-btn-primary { border: none; color: white; }
      .wak-dash-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 32px; }
      @media (min-width: 640px) { .wak-dash-stats { grid-template-columns: repeat(4, 1fr); } }
      .wak-stat-card { border-radius: 12px; border: 1px solid #f3f4f6; background: white; padding: 16px; }
      .wak-stat-value { font-size: 24px; font-weight: 600; color: #111827; margin: 0; }
      .wak-stat-amber { color: #d97706; }
      .wak-stat-green { color: #059669; }
      .wak-stat-label { font-size: 12px; color: #6b7280; margin: 4px 0 0; }
      .wak-dash-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 24px; }
      .wak-scope-tabs { display: flex; gap: 4px; border-radius: 9999px; border: 1px solid #e5e7eb; background: #f9fafb; padding: 4px; }
      .wak-tab { border-radius: 9999px; padding: 4px 16px; font-size: 12px; font-weight: 500; color: #4b5563; background: transparent; border: none; cursor: pointer; }
      .wak-tab-active { color: white !important; }
      .wak-sep { width: 1px; height: 24px; background: #e5e7eb; }
      .wak-select { border-radius: 8px; border: 1px solid #e5e7eb; background: white; padding: 8px 12px; font-size: 13px; color: #374151; outline: none; }
      .wak-select:focus { border-color: ${accentColor}; }
      .wak-dash-list { display: flex; flex-direction: column; gap: 12px; }
      .wak-dash-item { border-radius: 12px; border: 1px solid #f3f4f6; background: white; padding: 20px; transition: all 0.15s; }
      .wak-dash-item.wak-others { padding: 12px 20px; background: rgba(249,250,251,0.7); }
      .wak-dash-item.wak-resolved { border-color: #d1fae5; opacity: 0.6; }
      .wak-dash-item-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .wak-dash-item-author { display: flex; align-items: center; gap: 12px; }
      .wak-avatar { display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 9999px; font-weight: 700; color: white; font-size: 12px; }
      .wak-avatar-sm { height: 24px; width: 24px; font-size: 10px; }
      .wak-dash-item-meta { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; row-gap: 4px; }
      .wak-page-link { color: ${accentColor}; font-size: 13px; text-decoration: none; }
      .wak-page-link:hover { text-decoration: underline; }
      .wak-small { font-size: 11px !important; color: #6b7280 !important; }
      .wak-dot { color: #d1d5db; }
      .wak-date { font-size: 11px; color: #9ca3af; }
      .wak-dash-item-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .wak-btn-pill-sm { border-radius: 9999px; padding: 4px 12px; font-size: 11px; font-weight: 500; color: #4b5563; background: #f3f4f6; border: none; cursor: pointer; }
      .wak-btn-pill-sm:hover { background: ${accentColor}1A; color: ${accentColor}; }
      .wak-btn-pill-sm.wak-done { background: #d1fae5; color: #065f46; }
      .wak-btn-pill-sm.wak-btn-danger { background: transparent; color: #fca5a5; }
      .wak-btn-pill-sm.wak-btn-danger:hover { background: #fef2f2; color: #dc2626; }
      .wak-resolved-tag { border-radius: 9999px; background: #d1fae5; padding: 2px 8px; font-size: 10px; font-weight: 500; color: #059669; }
      .wak-dash-item-body { display: flex; gap: 16px; margin-top: 12px; }
      .wak-dash-text { flex: 1; white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: #374151; }
      .wak-thumb-link { flex-shrink: 0; }
      .wak-thumb { border-radius: 8px; border: 1px solid #e5e7eb; object-fit: cover; object-position: top; box-shadow: 0 2px 4px rgba(0,0,0,0.05); height: 80px; width: 144px; }
      .wak-thumb-sm { height: 56px; width: 96px; }
      .wak-dash-meta { margin-top: 12px; border-radius: 8px; background: #f9fafb; padding: 8px 12px; font-size: 11px; color: #6b7280; }
      .wak-dash-meta p { margin: 0 0 2px; }
      .wak-mono { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #9ca3af; }
      .wak-updated { margin-top: 8px; font-size: 10px; font-style: italic; color: #9ca3af; }
      .wak-dash-empty { border-radius: 12px; border: 1px dashed #e5e7eb; background: white; padding: 64px 16px; text-align: center; color: #9ca3af; font-size: 13px; }
    `}</style>
  );
}
