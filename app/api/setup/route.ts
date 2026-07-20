import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { isAdminConfigured, setSetting } from "@/lib/db";
import { hashPassword, issueSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { applyBackupConfig } from "@/lib/backup-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETUP_TOKEN_PATH = "/etc/kindred/setup-token";

interface BackupConfig {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  restic_password: string | null;
}

interface SetupBody {
  admin_password?: string;
  admin_password_confirm?: string;
  setup_token?: string;
  backups?: BackupConfig;
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
  // Pre-hash the password (sanity-test argon2 before we commit).
  let hash: string;
  try {
    hash = await hashPassword(pw);
  } catch (e) {
    return NextResponse.json({ error: `Password hashing failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  // --- Step 6: validate optional backup config ----------------------------
  const backups = body.backups;
  let backupConfigOk = false;
  let backupErr: string | null = null;
  if (backups && backups.enabled) {
    backupConfigOk = true;
    const required = [backups.endpoint, backups.bucket, backups.prefix, backups.access_key_id, backups.secret_access_key];
    if (required.some((v) => typeof v !== "string" || v.length === 0)) {
      backupConfigOk = false;
      backupErr = "All backup fields are required when backups are enabled.";
    } else if (!backups.endpoint.startsWith("https://")) {
      backupConfigOk = false;
      backupErr = "Backup endpoint must start with https://.";
    }
  }

  if (!backupConfigOk && backupErr) {
    return NextResponse.json({ error: backupErr }, { status: 400 });
  }

  // --- Step 7: configure backups via privileged helper --------------------
  // Writes /etc/kindred/backup.env + restic.pass + installs systemd units
  // + sudoers rule + runs first backup, all as root via sudo.
  let backupApplyResult: { ok: true } | { ok: false; error: string };
  if (backups && backups.enabled) {
    const r = await applyBackupConfig({
      endpoint: backups.endpoint,
      bucket: backups.bucket,
      prefix: backups.prefix,
      region: backups.region || "",
      access_key_id: backups.access_key_id,
      secret_access_key: backups.secret_access_key,
      restic_password: backups.restic_password,
    });
    backupApplyResult = r.ok ? { ok: true } : { ok: false, error: r.error };
    if (!backupApplyResult.ok) {
      return NextResponse.json({ error: `Backup setup failed: ${backupApplyResult.error}` }, { status: 502 });
    }
  } else {
    backupApplyResult = { ok: true };
  }

  // --- Step 8: write the admin password hash (atomic) ---------------------
  // Done AFTER backup setup so that if backup config fails, the operator
  // can retry without re-rolling a password (and without the setup window
  // closing).
  setSetting("admin_password_hash", hash);

  // --- Step 9: consume the setup token (one-time) -------------------------
  await consumeSetupToken();

  // --- Step 10: issue session cookie --------------------------------------
  const cookie = await issueSessionCookie();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });
  return response;
}