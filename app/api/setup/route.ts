import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { isAdminConfigured, setSetting } from "@/lib/db";
import { hashPassword, issueSessionCookie } from "@/lib/auth";
import { isSecureRequest } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETUP_TOKEN_PATH = process.env.SETUP_TOKEN_FILE || "/etc/kindred/setup-token";

interface SetupBody {
  admin_password?: string;
  admin_password_confirm?: string;
  setup_token?: string;
}

const KEY_RE = /^[A-Za-z0-9+/=_-]+$/;

async function readSetupToken(): Promise<string | null> {
  try {
    const t = (await readFile(SETUP_TOKEN_PATH, "utf8")).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function consumeSetupToken(): Promise<void> {
  try {
    await unlink(SETUP_TOKEN_PATH);
  } catch {
    // Best-effort — the token has already been verified at this point.
  }
}

/**
 * POST /api/setup — complete first-run setup: create the admin account and
 * log the operator in. Backups are intentionally NOT configured here — the
 * wizard is one page (token + password); encrypted backups are enabled
 * afterwards from /admin/backups.
 *
 * Ordering is failure-atomic: everything that can throw (argon2 hashing,
 * cookie signing via AUTH_SECRET) happens BEFORE the password hash is
 * written and the token consumed, so a failure never leaves a
 * half-completed setup that can neither be retried nor logged into.
 */
export async function POST(request: NextRequest) {
  // --- Step 1: setup window open? ----------------------------------------
  if (isAdminConfigured()) {
    return NextResponse.json({ error: "Setup is already complete." }, { status: 410 });
  }

  // --- Step 2: rate limit -------------------------------------------------
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`setup:${ip}`, { max: 5, windowSeconds: 15 * 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // --- Step 3: parse body -------------------------------------------------
  let body: SetupBody;
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // --- Step 4: verify setup token -----------------------------------------
  // The first-run wizard has no auth; this one-time token (printed on the
  // console by setup-lxc.sh) is what proves the operator is at the keyboard.
  const storedToken = await readSetupToken();
  const suppliedToken = (body.setup_token || "").trim();
  if (!storedToken || !suppliedToken || !KEY_RE.test(suppliedToken) || suppliedToken !== storedToken) {
    return NextResponse.json({ error: "Setup token is missing or incorrect." }, { status: 403 });
  }

  // --- Step 5: validate admin password ------------------------------------
  const pw = body.admin_password || "";
  const pwConfirm = body.admin_password_confirm || "";
  if (pw.length < 12) {
    return NextResponse.json({ error: "Admin password must be at least 12 characters." }, { status: 400 });
  }
  if (pw.length > 1024 || pw !== pwConfirm) {
    return NextResponse.json({ error: "Admin passwords do not match." }, { status: 400 });
  }

  // --- Step 6: do everything that can throw BEFORE committing -------------
  let hash: string;
  try {
    hash = await hashPassword(pw);
  } catch (e) {
    return NextResponse.json({ error: `Password hashing failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  let cookie: Awaited<ReturnType<typeof issueSessionCookie>>;
  try {
    cookie = await issueSessionCookie();
  } catch (e) {
    // AUTH_SECRET missing — happens when the service was started before
    // /etc/kindred/auth.env existed (fresh-install ordering bug, fixed in
    // setup-lxc.sh; reachable on CTs provisioned by older installers).
    return NextResponse.json(
      {
        error:
          `Could not sign the session cookie: ${e instanceof Error ? e.message : String(e)} ` +
          "Fix: run `pct exec <CT_ID> -- systemctl restart kindred` on the Proxmox host, then retry — nothing has been written yet.",
      },
      { status: 500 },
    );
  }

  // --- Step 7: commit — write hash, consume token --------------------------
  setSetting("admin_password_hash", hash);
  await consumeSetupToken();

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: cookie.maxAge,
  });
  return response;
}
