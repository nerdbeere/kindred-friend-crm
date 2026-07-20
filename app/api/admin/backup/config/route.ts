import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv, invalidateBackupEnvCache } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKUP_ENV_FILE = process.env.BACKUP_ENV_FILE || "/etc/kindred/backup.env";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const env = await loadBackupEnv();
  return NextResponse.json({
    configured: Boolean(env.RESTIC_REPOSITORY),
    endpoint: env.BACKUP_S3_ENDPOINT || null,
    bucket: env.BACKUP_S3_BUCKET || null,
    prefix: env.BACKUP_S3_PREFIX || null,
    region: env.BACKUP_S3_REGION || null,
    keep_daily: env.BACKUP_KEEP_DAILY || "7",
    keep_weekly: env.BACKUP_KEEP_WEEKLY || "4",
    keep_monthly: env.BACKUP_KEEP_MONTHLY || "6",
    keep_within_hours: env.BACKUP_KEEP_WITHIN_HOURS || "24",
    check_weekly: env.BACKUP_CHECK_WEEKLY || "1",
  });
}

interface PutBody {
  keep_daily?: number;
  keep_weekly?: number;
  keep_monthly?: number;
  keep_within_hours?: number;
  check_weekly?: number;
}

export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Clamp + validate. All retention values must be small positive integers.
  const clamp = (v: unknown, lo: number, hi: number, def: number): number => {
    const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v), 10);
    if (!Number.isFinite(n) || n < lo || n > hi) return def;
    return n;
  };
  const newDaily = clamp(body.keep_daily, 1, 90, 7);
  const newWeekly = clamp(body.keep_weekly, 1, 52, 4);
  const newMonthly = clamp(body.keep_monthly, 1, 24, 6);
  const newWithin = clamp(body.keep_within_hours, 0, 168, 24);
  const newCheck = clamp(body.check_weekly, 0, 1, 1);

  // Read the existing backup.env, only swap the retention lines (don't
  // rewrite the secrets — we'd lose them if we round-tripped through JSON).
  let txt: string;
  try {
    txt = await readFile(BACKUP_ENV_FILE, "utf8");
  } catch {
    return NextResponse.json({ error: "Backups are not configured — enable first." }, { status: 409 });
  }

  const setLine = (key: string, value: number): string => `${key}=${value}`;
  const lines = txt.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq < 0) return line;
    const k = trimmed.slice(0, eq).trim();
    if (k === "BACKUP_KEEP_DAILY") return setLine("BACKUP_KEEP_DAILY", newDaily);
    if (k === "BACKUP_KEEP_WEEKLY") return setLine("BACKUP_KEEP_WEEKLY", newWeekly);
    if (k === "BACKUP_KEEP_MONTHLY") return setLine("BACKUP_KEEP_MONTHLY", newMonthly);
    if (k === "BACKUP_KEEP_WITHIN_HOURS") return setLine("BACKUP_KEEP_WITHIN_HOURS", newWithin);
    if (k === "BACKUP_CHECK_WEEKLY") return setLine("BACKUP_CHECK_WEEKLY", newCheck);
    return line;
  });

  try {
    // Preserve mode + ownership by writing via the same inode (truncate + write).
    // Since the Next.js process runs as `kindred` and the file is mode 0600
    // owned by root:kindred, this write will fail. We accept that and surface
    // a helpful error directing the operator to use the CLI / re-run the
    // installer, which is the safer path for changing retention on a live repo.
    await writeFile(BACKUP_ENV_FILE, lines.join("\n"), { mode: 0o600 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not write /etc/kindred/backup.env directly (it is root-owned). " +
          "Run `proxmox/enable-backup-lxc.sh <CT_ID>` from the Proxmox host with the new " +
          "retention values, or set BACKUP_KEEP_* env vars before re-running it.",
        suggested_values: {
          keep_daily: newDaily,
          keep_weekly: newWeekly,
          keep_monthly: newMonthly,
          keep_within_hours: newWithin,
          check_weekly: newCheck,
        },
      },
      { status: 403 },
    );
  }

  invalidateBackupEnvCache();
  return NextResponse.json({ ok: true, keep_daily: newDaily, keep_weekly: newWeekly, keep_monthly: newMonthly, keep_within_hours: newWithin, check_weekly: newCheck });
}