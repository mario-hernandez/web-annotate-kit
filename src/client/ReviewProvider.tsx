import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import type { ReviewComment, ReviewDepartment, ReviewUser } from './types';

/* ─── Context shape ─────────────────────────────────────────── */

interface ReviewContextType {
  user: ReviewUser | null;
  comments: ReviewComment[];
  departments: ReviewDepartment[];
  /** Admin-only: list of all users. Loaded lazily via refreshUsers(). */
  users: ReviewUser[] | null;
  config: {
    apiBase: string;
    apiKey: string;
    captureScreenshots: boolean;
    storageKeyPrefix: string;
    resolvedOpacity: number;
    resolvedPinOpacity: number;
  };
  login: (id: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  addComment: (partial: Omit<ReviewComment, 'id' | 'author' | 'authorColor' | 'createdAt' | 'status' | 'resolved' | 'notes'> & { department?: string }) => Promise<void>;
  updateComment: (id: string, text: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  /** Toggle between resolved ↔ open. Allowed for director/admin only (server enforced). */
  resolveComment: (id: string) => Promise<void>;
  /** Accept a comment (escalate to director's inbox). Allowed for the matching lead, director, admin. */
  acceptComment: (id: string) => Promise<void>;
  /** Append a note to a comment. Anyone authenticated. */
  addNote: (id: string, text: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshDepartments: () => Promise<void>;
  exportComments: () => string;
  exportCompact: () => string;
}

const Ctx = createContext<ReviewContextType | null>(null);
export const useReview = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReview() must be called inside <ReviewProvider>');
  return ctx;
};

/* ─── Public Provider props ─────────────────────────────────── */

export interface ReviewProviderProps {
  /** Shared secret sent as `X-API-Key` only on the login endpoint. Must match the server. */
  apiKey: string;
  /** Base URL of the review API (e.g. "/api"). Default: "/api". */
  apiBase?: string;
  /** Whether to capture a screenshot using the Screen Capture API on new comments. Default: true. */
  captureScreenshots?: boolean;
  /** Poll interval in ms to refresh comments. Default: 10000. */
  pollIntervalMs?: number;
  /** Screenshot timeout in ms. Default: 8000. */
  screenshotTimeoutMs?: number;
  /** Storage key prefix (localStorage). Default: "wak". */
  storageKeyPrefix?: string;
  /** Opacity for resolved comment cards in lists. Default: 0.45. */
  resolvedOpacity?: number;
  /** Opacity for resolved pins on the page (non-active). Default: 0.28. */
  resolvedPinOpacity?: number;
  children: ReactNode;
}

/* ─── Rate-limiting (client-side, kept from v0.2) ──────────── */

interface RLState { failures: number; lockedUntil: number }
const RL_KEY_SUFFIX = '-rl';

export function getRl(prefix: string): RLState {
  try {
    const r = localStorage.getItem(prefix + RL_KEY_SUFFIX);
    return r ? JSON.parse(r) : { failures: 0, lockedUntil: 0 };
  } catch { return { failures: 0, lockedUntil: 0 }; }
}
export function recordFailure(prefix: string): number {
  const rl = getRl(prefix);
  rl.failures += 1;
  const delays = [0, 0, 0, 5, 15, 60, 300, 900];
  const sec = rl.failures >= delays.length ? 900 : delays[rl.failures];
  rl.lockedUntil = sec > 0 ? Date.now() + sec * 1000 : 0;
  localStorage.setItem(prefix + RL_KEY_SUFFIX, JSON.stringify(rl));
  return sec;
}
export function clearRl(prefix: string) { localStorage.removeItem(prefix + RL_KEY_SUFFIX); }
export function getLockSeconds(prefix: string): number {
  const rl = getRl(prefix);
  return rl.lockedUntil ? Math.max(0, Math.ceil((rl.lockedUntil - Date.now()) / 1000)) : 0;
}

/* ─── Screenshot capture ─────────────────────────────────────── */

async function captureScreenshot(
  apiBase: string,
  commentId: string,
  xPercent: number,
  yPx: number,
): Promise<string | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
  } catch { return null; }

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(r));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;

    const scaleX = canvas.width / window.innerWidth;
    const scaleY = canvas.height / window.innerHeight;
    const mx = (xPercent / 100) * window.innerWidth * scaleX;
    const my = (yPx - window.scrollY) * scaleY;
    const r = 18 * scaleX;

    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3 * scaleX;
    ctx.stroke();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(mx - r + 4 * scaleX, my);
    ctx.lineTo(mx + r - 4 * scaleX, my);
    ctx.moveTo(mx, my - r + 4 * scaleY);
    ctx.lineTo(mx, my + r - 4 * scaleY);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2 * scaleX;
    ctx.stroke();

    const image = canvas.toDataURL('image/png');
    const res = await fetch(`${apiBase}/screenshots`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commentId, image }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url as string;
  } catch (e) {
    console.error('[web-annotate-kit] screenshot failed:', e);
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
}

/* ─── Provider ──────────────────────────────────────────────── */

export function ReviewProvider({
  apiKey,
  apiBase = '/api',
  captureScreenshots = true,
  pollIntervalMs = 10_000,
  screenshotTimeoutMs = 8000,
  storageKeyPrefix = 'wak',
  resolvedOpacity = 0.45,
  resolvedPinOpacity = 0.28,
  children,
}: ReviewProviderProps) {
  const SK_COMMENTS = `${storageKeyPrefix}-comments`;

  // Note: we deliberately do NOT seed comments from localStorage at boot.
  // /reviews now requires a session; rendering stale comments before fetchMe()
  // resolves would leak them on shared/expired browsers. The first authenticated
  // refresh repopulates state in milliseconds.
  const [user, setUser] = useState<ReviewUser | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [departments, setDepartments] = useState<ReviewDepartment[]>([]);
  const [users, setUsers] = useState<ReviewUser[] | null>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cacheLocally = useCallback((data: ReviewComment[]) => {
    localStorage.setItem(SK_COMMENTS, JSON.stringify(data));
  }, [SK_COMMENTS]);

  /* ── Network helpers ───────────────────────────────────── */

  const fetchComments = useCallback(async (): Promise<ReviewComment[] | null> => {
    try {
      const res = await fetch(`${apiBase}/reviews`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return (await res.json()) as ReviewComment[];
    } catch { return null; }
  }, [apiBase]);

  const sendAction = useCallback(async (action: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`${apiBase}/reviews`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ReviewComment[];
    } catch { return null; }
  }, [apiBase]);

  const refresh = useCallback(async () => {
    const remote = await fetchComments();
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [fetchComments, cacheLocally]);

  const refreshDepartments = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/departments`, { credentials: 'same-origin' });
      if (!res.ok) return;
      setDepartments(await res.json());
    } catch { /* offline */ }
  }, [apiBase]);

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/users`, { credentials: 'same-origin' });
      if (!res.ok) { setUsers(null); return; }
      setUsers(await res.json());
    } catch { setUsers(null); }
  }, [apiBase]);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'same-origin' });
      if (!res.ok) {
        // No (or revoked) session: drop any locally-cached comments so a shared
        // browser can't reveal them after the cookie was invalidated server-side.
        setUser(null);
        setComments([]);
        try { localStorage.removeItem(SK_COMMENTS); } catch { /* ignore */ }
        return;
      }
      const { user } = await res.json();
      setUser(user as ReviewUser);
    } catch { setUser(null); }
  }, [apiBase, SK_COMMENTS]);

  /* ── Boot: load auth first; gate everything else on a valid session ───────── */

  useEffect(() => { fetchMe(); }, [fetchMe]);

  // Sync comments + departments only while authenticated. The /reviews and
  // /departments endpoints require a session, so calling them logged-out is
  // both wasteful and surfaces 401s; gate them at the source.
  useEffect(() => {
    if (!user) {
      // stop polling and discard cache when there's no session
      if (syncRef.current) { clearInterval(syncRef.current); syncRef.current = null; }
      return;
    }
    refreshDepartments();
    refresh();
    syncRef.current = setInterval(refresh, pollIntervalMs);
    return () => {
      if (syncRef.current) { clearInterval(syncRef.current); syncRef.current = null; }
    };
  }, [user, refresh, refreshDepartments, pollIntervalMs]);

  /* ── Auth ──────────────────────────────────────────────── */

  const login = useCallback(async (id: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ id: id.trim(), password: password.trim() }),
      });
      if (!res.ok) return false;
      const { user } = await res.json();
      setUser(user as ReviewUser);
      return true;
    } catch { return false; }
  }, [apiBase, apiKey]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    } finally {
      // Wipe in-memory + persisted state. Without this, a shared browser would
      // still expose the cached comments via localStorage to the next visitor.
      setUser(null);
      setUsers(null);
      setComments([]);
      setDepartments([]);
      try { localStorage.removeItem(SK_COMMENTS); } catch { /* ignore */ }
    }
  }, [apiBase, SK_COMMENTS]);

  /* ── CRUD ──────────────────────────────────────────────── */

  const addComment: ReviewContextType['addComment'] = useCallback(async (partial) => {
    if (!user) return;
    const id = crypto.randomUUID();
    const optimistic: ReviewComment = {
      ...partial,
      id,
      author: user.name,
      authorColor: user.color,
      createdAt: new Date().toISOString(),
      status: 'open',
      resolved: false,
      department: partial.department ?? 'general',
      notes: [],
    } as ReviewComment;
    setComments((prev) => { const next = [...prev, optimistic]; cacheLocally(next); return next; });
    const remote = await sendAction('add', { id, ...partial, department: partial.department ?? 'general' });
    if (remote) { setComments(remote); cacheLocally(remote); }

    if (captureScreenshots) {
      try {
        const timeoutP = new Promise<null>((resolve) => setTimeout(() => resolve(null), screenshotTimeoutMs));
        const screenshotUrl = await Promise.race([
          captureScreenshot(apiBase, id, partial.x, partial.y),
          timeoutP,
        ]);
        if (screenshotUrl) {
          await sendAction('update-screenshot', { id, screenshotUrl });
          refresh();
        }
      } catch (e) {
        console.warn('[web-annotate-kit] screenshot skipped:', (e as Error).message);
      }
    }
  }, [user, cacheLocally, sendAction, captureScreenshots, apiBase, screenshotTimeoutMs, refresh]);

  const updateComment = useCallback(async (id: string, text: string) => {
    setComments((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, text, updatedAt: new Date().toISOString() } : c));
      cacheLocally(next); return next;
    });
    const remote = await sendAction('update', { id, text });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [cacheLocally, sendAction]);

  const deleteComment = useCallback(async (id: string) => {
    setComments((prev) => { const next = prev.filter((c) => c.id !== id); cacheLocally(next); return next; });
    const remote = await sendAction('delete', { id });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [cacheLocally, sendAction]);

  const resolveComment = useCallback(async (id: string) => {
    setComments((prev) => {
      const next: ReviewComment[] = prev.map((c) => {
        if (c.id !== id) return c;
        const nextStatus: ReviewComment['status'] = c.status === 'resolved' ? 'open' : 'resolved';
        return { ...c, status: nextStatus, resolved: nextStatus === 'resolved' };
      });
      cacheLocally(next); return next;
    });
    const remote = await sendAction('resolve', { id });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [cacheLocally, sendAction]);

  const acceptComment = useCallback(async (id: string) => {
    setComments((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, status: 'accepted' as const, acceptedAt: new Date().toISOString(), acceptedBy: user?.name ?? null } : c));
      cacheLocally(next); return next;
    });
    const remote = await sendAction('accept', { id });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [cacheLocally, sendAction, user]);

  const addNote = useCallback(async (id: string, text: string) => {
    if (!user || !text.trim()) return;
    const remote = await sendAction('add-note', { id, text: text.trim() });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [user, cacheLocally, sendAction]);

  /* ─── Exports ───────────────────────────────────────────── */

  const exportComments = useCallback(
    () => JSON.stringify(comments.filter((c) => c.status !== 'resolved'), null, 2),
    [comments],
  );
  const exportCompact = useCallback(() => {
    return comments
      .filter((c) => c.status !== 'resolved')
      .sort((a, b) => a.page.localeCompare(b.page) || a.y - b.y)
      .map((c) => {
        const where = [c.page];
        if (c.department && c.department !== 'general') where.push(`#${c.department}`);
        if (c.section) where.push(`section "${c.section}"`);
        if (c.tagName) where.push(`<${c.tagName.toLowerCase()}>`);
        if (c.nearestText) where.push(`"${c.nearestText.slice(0, 80)}"`);
        const head = `[${c.author}] ${where.join(' → ')}\n  ${c.text}`;
        const notes = (c.notes ?? []).map((n) => `  ↳ [${n.author}] ${n.text}`).join('\n');
        return notes ? `${head}\n${notes}` : head;
      })
      .join('\n\n');
  }, [comments]);

  return (
    <Ctx.Provider
      value={{
        user, comments, departments, users,
        config: { apiBase, apiKey, captureScreenshots, storageKeyPrefix, resolvedOpacity, resolvedPinOpacity },
        login, logout,
        addComment, updateComment, deleteComment, resolveComment, acceptComment, addNote,
        refreshUsers, refreshDepartments,
        exportComments, exportCompact,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
