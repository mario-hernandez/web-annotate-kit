import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useReview } from './ReviewProvider';
import { canActOnComment } from './permissions';

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

type StatusFilter = 'all' | 'open' | 'accepted' | 'resolved';

export default function ReviewDashboard({
  LinkComponent,
  homePath = '/',
  accentColor = '#305B91',
  title = 'Review',
}: ReviewDashboardProps = {}) {
  const {
    user, comments, departments,
    deleteComment, resolveComment, acceptComment,
    exportComments, exportCompact, config,
  } = useReview();
  const { resolvedOpacity, storageKeyPrefix } = config;
  const SHOW_RESOLVED_KEY = `${storageKeyPrefix}-show-resolved`;

  const isLead = user?.role === 'lead';
  const isDirector = user?.role === 'director';
  const isAdmin = user?.role === 'admin';

  const defaultStatus: StatusFilter =
    isDirector ? 'accepted'
    : isLead ? 'open'
    : 'open';

  const [filterAuthor, setFilterAuthor] = useState('all');
  const [filterPage, setFilterPage] = useState('all');
  const [filterDept, setFilterDept] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>(() => {
    if (typeof window === 'undefined') return defaultStatus;
    const stored = localStorage.getItem(SHOW_RESOLVED_KEY);
    if (stored === 'true') return 'all';
    return defaultStatus;
  });
  const [filterScope, setFilterScope] = useState<'mine' | 'team' | 'all'>('all');
  const [copied, setCopied] = useState(false);

  // For leads, pre-select their own department on first mount
  useEffect(() => {
    if (isLead && user?.departmentId) {
      setFilterDept(user.departmentId);
    }
  }, [isLead, user?.departmentId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (filterStatus === 'open') localStorage.setItem(SHOW_RESOLVED_KEY, 'false');
    else if (filterStatus === 'all' || filterStatus === 'resolved' || filterStatus === 'accepted') {
      localStorage.setItem(SHOW_RESOLVED_KEY, 'true');
    }
  }, [filterStatus, SHOW_RESOLVED_KEY]);

  const visible = comments;

  const pages = useMemo(() => [...new Set(visible.map((c) => c.page))].sort(), [visible]);
  const authors = useMemo(() => [...new Set(visible.map((c) => c.author))].sort(), [visible]);

  const myCount = visible.filter((c) => c.author === user?.name).length;
  const teamCount = visible.filter((c) => c.author !== user?.name).length;

  const filtered = useMemo(() => visible
    .filter((c) => {
      if (filterScope === 'mine' && c.author !== user?.name) return false;
      if (filterScope === 'team' && c.author === user?.name) return false;
      if (filterAuthor !== 'all' && c.author !== filterAuthor) return false;
      if (filterPage !== 'all' && c.page !== filterPage) return false;
      // Lead: dept filter is "their dept + general" unless overridden
      if (isLead && filterDept === 'all') {
        if (!(c.department === user?.departmentId || c.department === 'general')) return false;
      } else if (filterDept !== 'all' && c.department !== filterDept) return false;
      if (filterStatus === 'open' && c.status !== 'open') return false;
      if (filterStatus === 'accepted' && c.status !== 'accepted') return false;
      if (filterStatus === 'resolved' && c.status !== 'resolved') return false;
      return true;
    })
    .sort((a, b) => a.page.localeCompare(b.page) || a.y - b.y),
  [visible, filterScope, filterAuthor, filterPage, filterDept, filterStatus, user, isLead]);

  if (!user) return null;

  const openCount = visible.filter((c) => c.status === 'open').length;
  const acceptedCount = visible.filter((c) => c.status === 'accepted').length;
  const resolvedCount = visible.filter((c) => c.status === 'resolved').length;

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

  const subtitleByRole =
    isLead ? `Department lead — ${departments.find((d) => d.id === user.departmentId)?.name ?? user.departmentId ?? 'unassigned'}`
    : isDirector ? 'Director — escalation inbox'
    : isAdmin ? 'Administrator'
    : 'Reviewer';

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
                <span className="wak-dash-kpi-open">{subtitleByRole}</span>
                <span className="wak-dash-kpi-secondary">
                  {' · '}
                  {openCount} open · {acceptedCount} escalated · {resolvedCount} resolved · {pages.length} pages
                  {authors.length > 1 && ` · ${authors.length} reviewers`}
                </span>
              </p>
            </div>
          </div>
          <div className="wak-dash-actions">
            {(isAdmin || isDirector) && (
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
          <div className="wak-stat-card"><p className="wak-stat-value wak-stat-orange">{acceptedCount}</p><p className="wak-stat-label">Escalated</p></div>
          <div className="wak-stat-card"><p className="wak-stat-value wak-stat-green">{resolvedCount}</p><p className="wak-stat-label">Resolved</p></div>
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
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="wak-select">
            <option value="all">{isLead ? 'My dept + general' : 'All departments'}</option>
            <option value="general">General</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusFilter)} className="wak-select">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="accepted">Escalated</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <div className="wak-dash-list">
          {filtered.map((c) => {
            const dept = departments.find((d) => d.id === c.department);
            const deptColor = dept?.color || '#9CA3AF';
            const deptLabel = dept?.name || (c.department === 'general' ? 'General' : c.department);
            const canEdit = canActOnComment(user, 'edit', c);
            const canDelete = canActOnComment(user, 'delete', c);
            const canAccept = canActOnComment(user, 'accept', c);
            const canResolve = canActOnComment(user, 'resolve', c);
            const canReopen = canActOnComment(user, 'reopen', c);
            const dimmed = c.status === 'resolved';
            const itemClass =
              c.status === 'resolved' ? 'wak-resolved'
              : c.status === 'accepted' ? 'wak-accepted'
              : (canEdit ? 'wak-mine' : 'wak-others');

            return (
              <div key={c.id} className={`wak-dash-item ${itemClass}`}>
                <div className="wak-dash-item-header">
                  <div className="wak-dash-item-author">
                    <div className="wak-avatar" style={{ backgroundColor: c.authorColor || '#6B7280' }}>
                      {c.author[0]?.toUpperCase()}
                    </div>
                    <div className="wak-dash-item-meta">
                      <span className="wak-author-name">{c.author}</span>
                      <span className="wak-dot">·</span>
                      <span className="wak-dept-tag" style={{ backgroundColor: `${deptColor}22`, color: deptColor }}>{deptLabel}</span>
                      <span className="wak-dot">·</span>
                      <Link to={c.page} className="wak-page-link">{c.page}</Link>
                      <span className="wak-dot">·</span>
                      <span className="wak-date">{fmtDate(c.createdAt)}</span>
                      {c.status === 'accepted' && c.acceptedBy && (
                        <>
                          <span className="wak-dot">·</span>
                          <span className="wak-status-tag wak-status-accepted">↑ accepted by {c.acceptedBy}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="wak-dash-item-actions">
                    {canAccept && <button onClick={() => acceptComment(c.id)} className="wak-btn-pill-sm wak-btn-accept">Accept ↑</button>}
                    {canResolve && (
                      <button onClick={() => resolveComment(c.id)} className="wak-btn-pill-sm">Resolve</button>
                    )}
                    {canReopen && (
                      <button onClick={() => resolveComment(c.id)} className="wak-btn-pill-sm wak-btn-reopen">Reopen</button>
                    )}
                    {canDelete && <button onClick={() => deleteComment(c.id)} className="wak-btn-pill-sm wak-btn-danger">Delete</button>}
                  </div>
                </div>
                <div className="wak-dash-item-body">
                  <p className="wak-dash-text">{c.text}</p>
                  {c.screenshotUrl && (
                    <a href={c.screenshotUrl} target="_blank" rel="noopener noreferrer" className="wak-thumb-link">
                      <img src={c.screenshotUrl} alt="Capture" className="wak-thumb" />
                    </a>
                  )}
                </div>

                {(c.notes ?? []).length > 0 && (
                  <div className="wak-dash-notes">
                    {(c.notes ?? []).map((n) => (
                      <div key={n.id} className="wak-dash-note">
                        <span className="wak-dash-note-author" style={{ color: n.authorColor }}>{n.author}</span>
                        <span className="wak-dash-note-text">{n.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(c.section || c.nearestText || c.selector) && (
                  <div className="wak-dash-meta">
                    {c.section && <p><strong>Section:</strong> {c.section}</p>}
                    {c.nearestText && <p><strong>Near:</strong> {c.nearestText}</p>}
                    {c.selector && <p className="wak-mono">{c.tagName && `<${c.tagName.toLowerCase()}>`} {c.selector}</p>}
                  </div>
                )}
                {c.updatedAt && <p className="wak-updated">Edited {fmtDate(c.updatedAt)}</p>}
                {dimmed && <span className="wak-sr-only">resolved</span>}
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

      <DashboardStyles accentColor={accentColor} resolvedOpacity={resolvedOpacity} />
    </div>
  );
}

function DashboardStyles({ accentColor, resolvedOpacity }: { accentColor: string; resolvedOpacity: number }) {
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
      .wak-dash-kpi-open { font-size: 14px; font-weight: 600; color: #111827; }
      .wak-dash-kpi-secondary { font-size: 11px; color: #9ca3af; }
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
      .wak-stat-orange { color: #ea580c; }
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
      .wak-dash-item { border-radius: 12px; border: 1px solid #f3f4f6; background: white; padding: 20px; transition: opacity 300ms ease-out, filter 300ms ease-out, border-color 300ms ease-out; }
      .wak-dash-item.wak-others { padding: 12px 20px; background: rgba(249,250,251,0.7); }
      .wak-dash-item.wak-accepted { border-left: 3px solid #ea580c; padding-left: 17px; }
      .wak-dash-item.wak-resolved { border-color: #e5e7eb; opacity: ${resolvedOpacity}; }
      .wak-dash-item.wak-resolved .wak-author-name,
      .wak-dash-item.wak-resolved .wak-dash-text { text-decoration: line-through; text-decoration-color: rgba(0,0,0,0.25); text-decoration-thickness: 1px; }
      .wak-dash-item.wak-resolved .wak-thumb { filter: grayscale(0.6) saturate(0.5); transition: filter 300ms ease-out; }
      .wak-dash-item-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .wak-dash-item-author { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
      .wak-avatar { display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 9999px; font-weight: 700; color: white; font-size: 12px; }
      .wak-dash-item-meta { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; row-gap: 4px; min-width: 0; }
      .wak-page-link { color: ${accentColor}; font-size: 13px; text-decoration: none; }
      .wak-page-link:hover { text-decoration: underline; }
      .wak-dot { color: #d1d5db; }
      .wak-date { font-size: 11px; color: #9ca3af; }
      .wak-author-name { font-size: 13px; font-weight: 600; color: #111827; }
      .wak-dept-tag { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; }
      .wak-status-tag { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; }
      .wak-status-tag.wak-status-accepted { background: #fef3c7; color: #92400e; }
      .wak-dash-item-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
      .wak-btn-pill-sm { border-radius: 9999px; padding: 4px 12px; font-size: 11px; font-weight: 500; color: #4b5563; background: #f3f4f6; border: none; cursor: pointer; }
      .wak-btn-pill-sm:hover { background: ${accentColor}1A; color: ${accentColor}; }
      .wak-btn-pill-sm.wak-done { background: #d1fae5; color: #065f46; }
      .wak-btn-pill-sm.wak-btn-accept { background: #fef3c7; color: #92400e; }
      .wak-btn-pill-sm.wak-btn-accept:hover { background: #fde68a; color: #78350f; }
      .wak-btn-pill-sm.wak-btn-reopen { background: #e0e7ff; color: #3730a3; }
      .wak-btn-pill-sm.wak-btn-reopen:hover { background: #c7d2fe; color: #312e81; }
      .wak-btn-pill-sm.wak-btn-danger { background: transparent; color: #fca5a5; }
      .wak-btn-pill-sm.wak-btn-danger:hover { background: #fef2f2; color: #dc2626; }
      .wak-dash-item-body { display: flex; gap: 16px; margin-top: 12px; }
      .wak-dash-text { flex: 1; white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: #374151; margin: 0; }
      .wak-thumb-link { flex-shrink: 0; }
      .wak-thumb { border-radius: 8px; border: 1px solid #e5e7eb; object-fit: cover; object-position: top; box-shadow: 0 2px 4px rgba(0,0,0,0.05); height: 80px; width: 144px; }
      .wak-dash-notes { margin-top: 10px; padding: 8px 12px; border-left: 2px solid #e5e7eb; background: #fafafa; border-radius: 4px; }
      .wak-dash-note { font-size: 12px; line-height: 1.5; color: #4b5563; padding: 2px 0; }
      .wak-dash-note-author { font-weight: 600; margin-right: 6px; }
      .wak-dash-meta { margin-top: 12px; border-radius: 8px; background: #f9fafb; padding: 8px 12px; font-size: 11px; color: #6b7280; }
      .wak-dash-meta p { margin: 0 0 2px; }
      .wak-mono { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #9ca3af; }
      .wak-updated { margin-top: 8px; font-size: 10px; font-style: italic; color: #9ca3af; }
      .wak-dash-empty { border-radius: 12px; border: 1px dashed #e5e7eb; background: white; padding: 64px 16px; text-align: center; color: #9ca3af; font-size: 13px; }
      .wak-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
    `}</style>
  );
}
