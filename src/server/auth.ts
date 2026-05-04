import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PublicUser, UserRecord, UserRole } from './storage/types.js';

/* ─── Password hashing (scrypt, no external deps) ─────────── */

const SCRYPT_KEYLEN = 32;
const scryptAsync = promisify(scrypt) as (
  password: string, salt: string, keylen: number,
) => Promise<Buffer>;

export function hashPassword(password: string): string {
  // Sync: only ever called from admin write paths (create/edit user), not the hot login path.
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/**
 * Async verify. Off-loads scrypt to libuv's worker pool so the main event loop
 * stays responsive even under password-spray attempts.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  try {
    const hashBuf = Buffer.from(hash, 'hex');
    const candidate = await scryptAsync(password, salt, hashBuf.length);
    return hashBuf.length === candidate.length && timingSafeEqual(hashBuf, candidate);
  } catch {
    return false;
  }
}

/* ─── Session tokens (HMAC-signed JSON) ───────────────────── */

interface SessionPayload {
  uid: string;          // user id
  role: UserRole;       // duplicated for fast permission checks
  sv: number;           // session version — must match user's current sessionVersion to be valid
  iat: number;          // issued-at (epoch ms)
  exp: number;          // expires-at (epoch ms)
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signSession(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  secret: string,
  ttlMs: number,
): string {
  const now = Date.now();
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlMs };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full)));
  const sig = b64urlEncode(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64urlEncode(createHmac('sha256', secret).update(body).digest());
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() >= payload.exp) return null;
    if (typeof payload.sv !== 'number') return null; // legacy tokens without sv → invalid
    return payload;
  } catch {
    return null;
  }
}

/* ─── User projection (strip password hash) ──────────────── */

export function publicUser(u: UserRecord): PublicUser {
  return { id: u.id, name: u.name, color: u.color, role: u.role, departmentId: u.departmentId };
}
