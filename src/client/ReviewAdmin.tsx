import { useEffect, useState, type ReactNode } from 'react';
import { useReview } from './ReviewProvider';
import type { ReviewDepartment, ReviewRole, ReviewUser } from './types';

export interface ReviewAdminProps {
  LinkComponent?: (props: { to: string; className?: string; children: ReactNode }) => ReactNode;
  homePath?: string;
  accentColor?: string;
  /** Title for the admin page. Default: "Admin". */
  title?: string;
}

export default function ReviewAdmin({
  LinkComponent,
  homePath = '/',
  accentColor = '#305B91',
  title = 'Admin',
}: ReviewAdminProps = {}) {
  const { user, departments, users, refreshUsers, refreshDepartments, authedFetch, config } = useReview();
  const { apiBase } = config;

  const [tab, setTab] = useState<'users' | 'departments'>('users');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (user?.role === 'admin') {
      refreshUsers();
      refreshDepartments();
    }
  }, [user, refreshUsers, refreshDepartments]);

  const Link = LinkComponent ?? (({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ));

  if (!user) return null;
  if (user.role !== 'admin') {
    return (
      <div className="wak-admin-root">
        <div className="wak-admin-wrap">
          <p className="wak-admin-empty">Admin access only.</p>
        </div>
        <AdminStyles accentColor={accentColor} />
      </div>
    );
  }

  return (
    <div className="wak-admin-root">
      <div className="wak-admin-header">
        <div className="wak-admin-wrap">
          <div className="wak-admin-title-row">
            <Link to={homePath} className="wak-admin-back">
              <svg className="wak-icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="wak-admin-h1">{title}</h1>
              <p className="wak-admin-sub">Manage users and departments</p>
            </div>
          </div>
          <div className="wak-admin-tabs">
            <button onClick={() => setTab('users')} className={`wak-admin-tab ${tab === 'users' ? 'wak-active' : ''}`} style={tab === 'users' ? { borderColor: accentColor, color: accentColor } : undefined}>Users ({users?.length ?? 0})</button>
            <button onClick={() => setTab('departments')} className={`wak-admin-tab ${tab === 'departments' ? 'wak-active' : ''}`} style={tab === 'departments' ? { borderColor: accentColor, color: accentColor } : undefined}>Departments ({departments.length})</button>
          </div>
        </div>
      </div>

      <div className="wak-admin-wrap wak-admin-main">
        {error && <div className="wak-admin-error">{error}<button onClick={() => setError('')} className="wak-admin-close">×</button></div>}

        {tab === 'departments' && (
          <DepartmentsPanel
            apiBase={apiBase}
            authedFetch={authedFetch}
            departments={departments}
            onChanged={() => { refreshDepartments(); setError(''); }}
            onError={setError}
            accentColor={accentColor}
          />
        )}

        {tab === 'users' && (
          <UsersPanel
            apiBase={apiBase}
            authedFetch={authedFetch}
            users={users}
            departments={departments}
            currentUserId={user.id}
            onChanged={() => { refreshUsers(); setError(''); }}
            onError={setError}
            accentColor={accentColor}
          />
        )}
      </div>

      <AdminStyles accentColor={accentColor} />
    </div>
  );
}

/* ─── Departments ──────────────────────────────────────────── */

function DepartmentsPanel({
  apiBase, authedFetch, departments, onChanged, onError, accentColor,
}: {
  apiBase: string;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response | null>;
  departments: ReviewDepartment[];
  onChanged: () => void; onError: (s: string) => void; accentColor: string;
}) {
  const [draft, setDraft] = useState<ReviewDepartment>({ id: '', name: '', color: '#6B7280' });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.id.trim() || !draft.name.trim()) { onError('id and name are required'); return; }
    const res = await authedFetch(`${apiBase}/departments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res || !res.ok) { onError((res && await res.text()) || 'Failed to save department'); return; }
    setDraft({ id: '', name: '', color: '#6B7280' });
    onChanged();
  };

  const onDelete = async (id: string) => {
    const ok = confirm(`Delete department "${id}"? Comments assigned to it will keep the id but will read as "${id}".`);
    if (!ok) return;
    const res = await authedFetch(`${apiBase}/departments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res || !res.ok) { onError('Failed to delete'); return; }
    onChanged();
  };

  return (
    <div className="wak-admin-section">
      <form onSubmit={onSubmit} className="wak-admin-form">
        <input
          placeholder="id (e.g. design)"
          value={draft.id}
          onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          className="wak-admin-input"
        />
        <input
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="wak-admin-input"
        />
        <input
          type="color"
          value={draft.color}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          className="wak-admin-color"
        />
        <button type="submit" className="wak-admin-btn-primary" style={{ backgroundColor: accentColor }}>+ Add / Update</button>
      </form>

      <div className="wak-admin-list">
        {departments.length === 0 && <p className="wak-admin-empty">No departments yet. Create the first one above.</p>}
        {departments.map((d) => (
          <div key={d.id} className="wak-admin-row">
            <span className="wak-admin-color-swatch" style={{ background: d.color }} />
            <div className="wak-admin-row-body">
              <span className="wak-admin-row-id">{d.id}</span>
              <span className="wak-admin-row-name">{d.name}</span>
            </div>
            <button onClick={() => setDraft(d)} className="wak-admin-btn-link">Edit</button>
            <button onClick={() => onDelete(d.id)} className="wak-admin-btn-link wak-danger">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Users ──────────────────────────────────────────────── */

interface UserDraft {
  id: string;
  name: string;
  password: string;
  color: string;
  role: ReviewRole;
  departmentId: string | null;
}
const emptyUserDraft = (): UserDraft => ({ id: '', name: '', password: '', color: '#6B7280', role: 'reviewer', departmentId: null });

function UsersPanel({
  apiBase, authedFetch, users, departments, currentUserId, onChanged, onError, accentColor,
}: {
  apiBase: string;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response | null>;
  users: ReviewUser[] | null; departments: ReviewDepartment[];
  currentUserId: string; onChanged: () => void; onError: (s: string) => void; accentColor: string;
}) {
  const [draft, setDraft] = useState<UserDraft>(emptyUserDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.id.trim() || !draft.name.trim()) { onError('id and name are required'); return; }
    if (!editingId && !draft.password) { onError('Password required for new users'); return; }
    if (draft.role === 'lead' && !draft.departmentId) { onError('Lead must have a department'); return; }

    const url = editingId ? `${apiBase}/users/${encodeURIComponent(editingId)}` : `${apiBase}/users`;
    const method = editingId ? 'PATCH' : 'POST';
    const body: Record<string, unknown> = {
      name: draft.name,
      color: draft.color,
      role: draft.role,
      departmentId: draft.role === 'lead' ? draft.departmentId : null,
    };
    if (!editingId) body.id = draft.id;
    if (draft.password) body.password = draft.password;
    const res = await authedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) { onError((res && await res.text()) || 'Failed to save user'); return; }
    setDraft(emptyUserDraft());
    setEditingId(null);
    onChanged();
  };

  const startEdit = (u: ReviewUser) => {
    setDraft({ id: u.id, name: u.name, password: '', color: u.color, role: u.role, departmentId: u.departmentId ?? null });
    setEditingId(u.id);
  };

  const cancelEdit = () => { setDraft(emptyUserDraft()); setEditingId(null); };

  const onDelete = async (id: string) => {
    if (id === currentUserId) { onError("You can't delete yourself."); return; }
    const ok = confirm(`Delete user "${id}"? Their existing comments will be preserved.`);
    if (!ok) return;
    const res = await authedFetch(`${apiBase}/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res || !res.ok) { onError((res && await res.text()) || 'Failed to delete'); return; }
    onChanged();
  };

  return (
    <div className="wak-admin-section">
      <form onSubmit={onSubmit} className="wak-admin-form wak-admin-form-grid">
        <input
          placeholder="id (e.g. alice)"
          value={draft.id}
          onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          disabled={!!editingId}
          className="wak-admin-input"
        />
        <input
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="wak-admin-input"
        />
        <input
          type="password"
          placeholder={editingId ? 'New password (leave empty to keep)' : 'Password'}
          value={draft.password}
          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          className="wak-admin-input"
          autoComplete="new-password"
        />
        <select
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value as ReviewRole })}
          className="wak-admin-input"
        >
          <option value="reviewer">Reviewer</option>
          <option value="lead">Lead</option>
          <option value="director">Director</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={draft.departmentId ?? ''}
          onChange={(e) => setDraft({ ...draft, departmentId: e.target.value || null })}
          disabled={draft.role !== 'lead'}
          className="wak-admin-input"
        >
          <option value="">— department —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input
          type="color"
          value={draft.color}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          className="wak-admin-color"
        />
        <div className="wak-admin-form-actions">
          {editingId && <button type="button" onClick={cancelEdit} className="wak-admin-btn-ghost">Cancel</button>}
          <button type="submit" className="wak-admin-btn-primary" style={{ backgroundColor: accentColor }}>
            {editingId ? 'Save changes' : '+ Add user'}
          </button>
        </div>
      </form>

      <div className="wak-admin-list">
        {(users ?? []).length === 0 && <p className="wak-admin-empty">No users loaded.</p>}
        {(users ?? []).map((u) => {
          const dept = departments.find((d) => d.id === u.departmentId);
          return (
            <div key={u.id} className="wak-admin-row">
              <span className="wak-admin-color-swatch" style={{ background: u.color }} />
              <div className="wak-admin-row-body">
                <span className="wak-admin-row-id">{u.name}</span>
                <span className="wak-admin-row-meta">
                  {u.role}{dept ? ` · ${dept.name}` : ''}{u.id === currentUserId ? ' · you' : ''}
                </span>
              </div>
              <button onClick={() => startEdit(u)} className="wak-admin-btn-link">Edit</button>
              <button onClick={() => onDelete(u.id)} className="wak-admin-btn-link wak-danger" disabled={u.id === currentUserId}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Styles ──────────────────────────────────────────────── */

function AdminStyles({ accentColor }: { accentColor: string }) {
  return (
    <style>{`
      .wak-admin-root { min-height: 100vh; background: #f9fafb; font-family: system-ui, -apple-system, sans-serif; }
      .wak-admin-header { border-bottom: 1px solid #e5e7eb; background: white; }
      .wak-admin-wrap { max-width: 960px; margin: 0 auto; padding: 16px 24px; }
      .wak-admin-main { padding-top: 24px; padding-bottom: 32px; }
      .wak-admin-title-row { display: flex; align-items: center; gap: 16px; }
      .wak-admin-back { display: inline-flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 8px; color: #9ca3af; text-decoration: none; }
      .wak-admin-back:hover { background: #f3f4f6; color: #6b7280; }
      .wak-admin-h1 { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
      .wak-admin-sub { font-size: 12px; color: #6b7280; margin: 2px 0 0; }
      .wak-admin-header .wak-admin-wrap { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
      .wak-admin-tabs { display: flex; gap: 4px; }
      .wak-admin-tab { background: transparent; border: none; padding: 8px 16px; font-size: 13px; font-weight: 500; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; }
      .wak-admin-tab:hover { color: #374151; }
      .wak-admin-tab.wak-active { color: #111827; }

      .wak-admin-section { display: flex; flex-direction: column; gap: 24px; }
      .wak-admin-form { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; background: white; border: 1px solid #e5e7eb; border-radius: 12px; align-items: center; }
      .wak-admin-form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 120px 1fr 56px auto; gap: 8px; }
      @media (max-width: 800px) { .wak-admin-form-grid { grid-template-columns: 1fr 1fr; } }
      .wak-admin-input { border-radius: 8px; border: 1px solid #e5e7eb; padding: 8px 12px; font-size: 13px; outline: none; font-family: inherit; background: white; }
      .wak-admin-input:focus { border-color: ${accentColor}; }
      .wak-admin-input:disabled { opacity: 0.6; }
      .wak-admin-color { width: 56px; height: 36px; border-radius: 8px; border: 1px solid #e5e7eb; padding: 2px; cursor: pointer; background: white; }
      .wak-admin-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .wak-admin-btn-primary { background: ${accentColor}; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
      .wak-admin-btn-ghost { background: transparent; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 16px; font-size: 13px; color: #6b7280; cursor: pointer; }

      .wak-admin-list { display: flex; flex-direction: column; gap: 8px; }
      .wak-admin-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: white; border: 1px solid #f3f4f6; border-radius: 12px; }
      .wak-admin-color-swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.08); flex-shrink: 0; }
      .wak-admin-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .wak-admin-row-id { font-size: 13px; font-weight: 600; color: #111827; }
      .wak-admin-row-name { font-size: 12px; color: #6b7280; }
      .wak-admin-row-meta { font-size: 11px; color: #9ca3af; }
      .wak-admin-btn-link { background: transparent; border: none; color: #6b7280; font-size: 12px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .wak-admin-btn-link:hover { background: #f3f4f6; color: #374151; }
      .wak-admin-btn-link.wak-danger { color: #ef4444; }
      .wak-admin-btn-link.wak-danger:hover { background: #fef2f2; color: #dc2626; }
      .wak-admin-btn-link:disabled { opacity: 0.4; cursor: not-allowed; }

      .wak-admin-empty { padding: 32px 16px; text-align: center; font-size: 13px; color: #9ca3af; background: white; border: 1px dashed #e5e7eb; border-radius: 12px; }

      .wak-admin-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 8px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 16px; }
      .wak-admin-close { background: transparent; border: none; color: inherit; font-size: 18px; cursor: pointer; }
      .wak-icon-sm { height: 16px; width: 16px; }
    `}</style>
  );
}
