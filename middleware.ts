import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";

/**
 * Middleware: lightweight cookie-only auth check for /admin/* and
 * /api/admin/* paths.
 *
 * The first-run setup-window gate (no admin password configured yet) is
 * intentionally handled in the server components and route handlers
 * themselves (they all call `isAdminConfigured()` from lib/db) rather
 * than here, so this middleware doesn't need to import better-sqlite3
 * (native) or lib/db.
 *
 * Always-pass-through paths:
 *   /, /setup, /api/contacts/*, /api/feed/*, /api/setup
 *
 * Why these are deliberately open:
 *   - /api/feed/* must remain open (Home Assistant polls it)
 *   - /api/contacts/* is the existing v1 API; locking it down is a
 *     follow-up (see docs/BACKUPS.md §13)
 *   - /setup and POST /api/setup are gated by the one-time setup token
 *     plus the empty-DB check, not by a session cookie
 */

// Run middleware in the nodejs runtime so it can use Node's `crypto` module
// (lib/session.ts uses createHmac + timingSafeEqual — not available in the
// Edge runtime's Web Crypto). This is fine for a single-container self-hosted app.
export const runtime = "nodejs";

const ADMIN_PATHS = ["/admin", "/api/admin"];
const OPEN_API_PATHS = ["/api/contacts", "/api/feed", "/api/setup"];
const OPEN_PAGES = ["/", "/setup"];
// The login page + login API must stay reachable WITHOUT a session —
// otherwise an expired cookie could never be replaced (and /admin/login
// would redirect onto itself).
const OPEN_AUTH_PATHS = ["/admin/login", "/api/admin/login"];

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    OPEN_PAGES.includes(pathname) ||
    OPEN_AUTH_PATHS.includes(pathname) ||
    startsWithAny(pathname, OPEN_API_PATHS)
  ) {
    return NextResponse.next();
  }
  if (!startsWithAny(pathname, ADMIN_PATHS)) {
    return NextResponse.next();
  }
  if (isAuthenticated(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};