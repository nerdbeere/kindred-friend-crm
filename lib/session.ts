import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { NextRequest } from "next/server";

/**
 * Pure session-cookie logic — no DB, no argon2, no next/headers.
 *
 * Imported by middleware.ts (which runs in nodejs runtime) and by
 * lib/auth.ts (which adds password hashing + DB lookups on top).
 *
 * See docs/BACKUPS.md §3 (threat model) and §9 (auth & UI).
 */

export const SESSION_COOKIE = "kindred_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

const AUTH_ENV_FILE = process.env.AUTH_ENV_FILE || "/etc/kindred/auth.env";

let cachedSecret: string | null = null;

/**
 * Resolve the cookie-signing secret. Primary source: AUTH_SECRET env var
 * (loaded by systemd EnvironmentFile=). Fallback: read /etc/kindred/auth.env
 * directly — the file is 0640 root:kindred, i.e. readable by the service
 * account this process runs as.
 *
 * Why the fallback exists: systemd reads EnvironmentFile only at unit
 * start, so any install/update ordering that mints auth.env after the
 * service is already running would otherwise leave the process without a
 * secret until the next restart (the fresh-install "setup failed" bug).
 * Reading the file lazily makes that class of ordering bugs self-healing.
 */
function getAuthSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv) {
    cachedSecret = fromEnv;
    return fromEnv;
  }
  try {
    const txt = readFileSync(AUTH_ENV_FILE, "utf8");
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() === "AUTH_SECRET") {
        const v = trimmed.slice(eq + 1).trim();
        if (v) {
          cachedSecret = v;
          return v;
        }
      }
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "AUTH_SECRET is not set and could not be read from /etc/kindred/auth.env — " +
      "run `pct exec <CT_ID> -- bash /opt/kindred/scripts/setup-auth.sh` and `systemctl restart kindred` inside the CT.",
  );
}

/** Build the signed cookie value: `base64url(json).base64url(hmac)`. */
export function signSession(expiresAt: number): string {
  const payload = JSON.stringify({ v: 1, iat: Math.floor(Date.now() / 1000), exp: expiresAt });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = createHmac("sha256", getAuthSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/** Verify a signed cookie value. Returns true iff signature matches and not expired. */
export function verifySession(value: string | undefined | null): boolean {
  if (!value || typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  const expected = createHmac("sha256", getAuthSecret()).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      v?: number;
      exp?: number;
    };
    if (payload.v !== 1 || typeof payload.exp !== "number") return false;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

/** Issue a 14-day signed session cookie descriptor. */
export function issueSessionCookie(): { name: string; value: string; maxAge: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return {
    name: SESSION_COOKIE,
    value: signSession(expiresAt),
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** True iff the request carries a valid `kindred_admin` cookie. */
export function isAuthenticated(request: NextRequest): boolean {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

/** CSRF: same-origin check for admin POST/PUT/DELETE. */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    const url = new URL(origin);
    return url.host === host;
  } catch {
    return false;
  }
}

/**
 * Should the session cookie carry the `Secure` attribute for THIS request?
 *
 * Kindred is self-hosted and commonly reached over plain HTTP on a home
 * network (http://192.168.x.x). Browsers silently DROP `Secure` cookies set
 * over HTTP — so gating on NODE_ENV === "production" made logins never
 * stick on LAN installs. Set Secure only when the request actually arrived
 * via HTTPS (directly or behind a TLS-terminating proxy).
 */
export function isSecureRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === "https:") return true;
  const fwd = request.headers.get("x-forwarded-proto");
  return fwd?.split(",")[0]?.trim().toLowerCase() === "https";
}