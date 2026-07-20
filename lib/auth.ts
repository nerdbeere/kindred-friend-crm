import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { getSetting, setSetting, isAdminConfigured } from "./db";
import {
  SESSION_COOKIE,
  issueSessionCookie as issueSessionCookieBase,
  isAuthenticated as isAuthenticatedRequest,
  verifySession,
  isSameOrigin as isSameOriginRequest,
} from "./session";

/**
 * Admin auth (password hashing + DB lookups) layered on top of lib/session.ts.
 *
 * Middleware and other contexts that can't import native modules (argon2)
 * or `next/headers` should import directly from lib/session.ts instead.
 *
 * See docs/BACKUPS.md §3 (threat model) and §9 (auth & UI).
 */

export { SESSION_COOKIE } from "./session";

// @node-rs/argon2's `Algorithm` is a `const enum`, which is incompatible with
// `isolatedModules` (Next's default). Use the raw value (Argon2id = 2) directly.
const ARGON2ID = 2;
const ARGON2_OPTS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB — OWASP minimum for argon2id m=19456 t=2 p=1
  timeCost: 2,
  parallelism: 1,
};

/** Argon2id hash a plaintext password. Returns the encoded string. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

/** Verify a plaintext password against a stored argon2id hash. */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

/** Verify the admin password against the hash in `settings`. False if no admin set. */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const stored = getSetting("admin_password_hash");
  if (!stored) return false;
  return verifyPassword(password, stored);
}

/** Set (or rotate) the admin password hash in `settings`. */
export async function setAdminPassword(password: string): Promise<void> {
  const encoded = await hashPassword(password);
  setSetting("admin_password_hash", encoded);
}

/** Re-export isAdminConfigured so admin code can import everything from one place. */
export { isAdminConfigured };

/** Issue a 14-day signed session cookie descriptor. */
export async function issueSessionCookie() {
  return issueSessionCookieBase();
}

/** Same-origin CSRF check (re-export of the pure helper). */
export function isSameOrigin(request: NextRequest): boolean {
  return isSameOriginRequest(request);
}

/** True iff the request carries a valid `kindred_admin` cookie (re-export). */
export function isAuthenticated(request: NextRequest): boolean {
  return isAuthenticatedRequest(request);
}

/** True iff the server-component context carries a valid `kindred_admin` cookie. */
export async function isAuthenticatedServer(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Convenience: returns ok or 401 sentinel. */
export async function requireAuth(
  request: NextRequest,
): Promise<{ ok: true } | { ok: false; status: 401 }> {
  if (isAuthenticatedRequest(request)) return { ok: true };
  return { ok: false, status: 401 };
}