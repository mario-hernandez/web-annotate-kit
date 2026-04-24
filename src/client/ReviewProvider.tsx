import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import type { ReviewComment, ReviewUser, ReviewUserDef } from './types';

/* ─── Context shape ─────────────────────────────────────────── */

interface ReviewContextType {
  user: ReviewUser | null;
  comments: ReviewComment[];
  config: {
    apiBase: string;
    apiKey: string;
    captureScreenshots: boolean;
    sessionCookieName: string;
    storageKeyPrefix: string;
    resolvedOpacity: number;
    resolvedPinOpacity: number;
  };
  login: (password: string, remember?: boolean) => boolean;
  logout: () => void;
  addComment: (partial: Omit<ReviewComment, 'id' | 'author' | 'authorColor' | 'createdAt'>) => Promise<void>;
  updateComment: (id: string, text: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  resolveComment: (id: string) => Promise<void>;
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
  /** List of allowed reviewers. Password is used as the login credential. */
  users: ReviewUserDef[];
  /** Shared secret sent as `X-API-Key` on mutating requests. Must match the server. */
  apiKey: string;
  /** Base URL of the review API (e.g. "/api"). Default: "/api". */
  apiBase?: string;
  /**
   * Whether to capture a screenshot using the Screen Capture API when a comment is created.
   * Default: true.
   */
  captureScreenshots?: boolean;
  /** Poll interval in ms to refresh comments from server. Default: 10000. */
  pollIntervalMs?: number;
  /** Screenshot timeout in ms. Default: 8000. */
  screenshotTimeoutMs?: number;
  /** Storage key prefix (localStorage). Default: "wak" (web-annotate-kit). */
  storageKeyPrefix?: string;
  /** Session cookie name. Default: "wak_session". */
  sessionCookieName?: string;
  /** Session cookie duration in days. Default: 30. */
  sessionCookieDays?: number;
  /** Opacity for resolved comment cards / items in lists. Default: 0.45. */
  resolvedOpacity?: number;
  /** Opacity for resolved pins on the page (non-active). Default: 0.28. */
  resolvedPinOpacity?: number;
  children: ReactNode;
}

/* ─── Rate-limiting exports (used by <ReviewLogin>) ─────────── */

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
  apiKey: string,
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
  } catch {
    return null;
  }

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

    // Red marker at the comment anchor
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
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
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
  users,
  apiKey,
  apiBase = '/api',
  captureScreenshots = true,
  pollIntervalMs = 10_000,
  screenshotTimeoutMs = 8000,
  storageKeyPrefix = 'wak',
  sessionCookieName = 'wak_session',
  sessionCookieDays = 30,
  resolvedOpacity = 0.45,
  resolvedPinOpacity = 0.28,
  children,
}: ReviewProviderProps) {
  const SK_USER = `${storageKeyPrefix}-user`;
  const SK_COMMENTS = `${storageKeyPrefix}-comments`;

  const load = <T,>(key: string, fallback: T): T => {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
    catch { return fallback; }
  };

  const setCookie = (u: ReviewUser) => {
    const val = btoa(JSON.stringify(u));
    const expires = new Date(Date.now() + sessionCookieDays * 86400000).toUTCString();
    document.cookie = `${sessionCookieName}=${val}; expires=${expires}; path=/; SameSite=Lax`;
  };
  const getCookie = (): ReviewUser | null => {
    try {
      const m = document.cookie.match(new RegExp(`(?:^|; )${sessionCookieName}=([^;]*)`));
      if (!m) return null;
      return JSON.parse(atob(m[1]));
    } catch { return null; }
  };
  const clearCookie = () => {
    document.cookie = `${sessionCookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  };
  const loadUser = (): ReviewUser | null => load(SK_USER, null as ReviewUser | null) || getCookie();

  const [user, setUser] = useState<ReviewUser | null>(loadUser);
  const [comments, setComments] = useState<ReviewComment[]>(() => load(SK_COMMENTS, [] as ReviewComment[]));
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cacheLocally = useCallback((data: ReviewComment[]) => {
    localStorage.setItem(SK_COMMENTS, JSON.stringify(data));
  }, [SK_COMMENTS]);

  const fetchComments = useCallback(async (): Promise<ReviewComment[] | null> => {
    try {
      const res = await fetch(`${apiBase}/reviews`);
      if (!res.ok) return null;
      return (await res.json()) as ReviewComment[];
    } catch { return null; }
  }, [apiBase]);

  const sendAction = useCallback(async (action: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`${apiBase}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ action, data }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ReviewComment[];
    } catch { return null; }
  }, [apiBase, apiKey]);

  const refresh = useCallback(async () => {
    const remote = await fetchComments();
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [fetchComments, cacheLocally]);

  useEffect(() => {
    refresh();
    syncRef.current = setInterval(refresh, pollIntervalMs);
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [refresh, pollIntervalMs]);

  /* ─── Auth ──────────────────────────────────────────────── */

  const login = useCallback((password: string, remember = true): boolean => {
    const found = users.find((u) => u.password === password.trim());
    if (!found) return false;
    const { password: _p, ...session } = found;
    void _p;
    setUser(session);
    if (remember) {
      localStorage.setItem(SK_USER, JSON.stringify(session));
      setCookie(session);
    }
    return true;
  }, [users, SK_USER]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(SK_USER);
    clearCookie();
  }, [SK_USER]);

  /* ─── CRUD ──────────────────────────────────────────────── */

  const addComment = useCallback<ReviewContextType['addComment']>(async (partial) => {
    if (!user) return;
    const id = crypto.randomUUID();
    const comment: ReviewComment = {
      ...partial,
      id,
      author: user.name,
      authorColor: user.color,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => { const next = [...prev, comment]; cacheLocally(next); return next; });
    const remote = await sendAction('add', comment as unknown as Record<string, unknown>);
    if (remote) { setComments(remote); cacheLocally(remote); }

    if (captureScreenshots) {
      try {
        const timeoutP = new Promise<null>((resolve) => setTimeout(() => resolve(null), screenshotTimeoutMs));
        const screenshotUrl = await Promise.race([
          captureScreenshot(apiBase, apiKey, id, partial.x, partial.y),
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
  }, [user, cacheLocally, sendAction, captureScreenshots, apiBase, apiKey, screenshotTimeoutMs, refresh]);

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
      const next = prev.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c));
      cacheLocally(next); return next;
    });
    const remote = await sendAction('resolve', { id });
    if (remote) { setComments(remote); cacheLocally(remote); }
  }, [cacheLocally, sendAction]);

  /* ─── Exports ───────────────────────────────────────────── */

  const exportComments = useCallback(
    () => JSON.stringify(comments.filter((c) => !c.resolved), null, 2),
    [comments],
  );
  const exportCompact = useCallback(() => {
    return comments
      .filter((c) => !c.resolved)
      .sort((a, b) => a.page.localeCompare(b.page) || a.y - b.y)
      .map((c) => {
        const where = [c.page];
        if (c.section) where.push(`sección "${c.section}"`);
        if (c.tagName) where.push(`<${c.tagName.toLowerCase()}>`);
        if (c.nearestText) where.push(`"${c.nearestText.slice(0, 80)}"`);
        return `[${c.author}] ${where.join(' → ')}\n  ${c.text}`;
      })
      .join('\n\n');
  }, [comments]);

  return (
    <Ctx.Provider
      value={{
        user,
        comments,
        config: { apiBase, apiKey, captureScreenshots, sessionCookieName, storageKeyPrefix, resolvedOpacity, resolvedPinOpacity },
        login, logout,
        addComment, updateComment, deleteComment, resolveComment,
        exportComments, exportCompact,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
