import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv, runBin, SNAPSHOT_ID_RE } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) {
    return NextResponse.json({ error: "Backups are not configured." }, { status: 409 });
  }

  let body: { snapshot?: string; confirm?: string; dry_run?: boolean };
  try {
    body = (await request.json()) as { snapshot?: string; confirm?: string; dry_run?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const snapshot = (body.snapshot || "latest").trim();
  if (snapshot !== "latest" && !SNAPSHOT_ID_RE.test(snapshot)) {
    return NextResponse.json({ error: "Invalid snapshot id." }, { status: 400 });
  }

  // Destructive action — require the typed confirmation phrase.
  if (body.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: "Confirmation required. Re-send with confirm: \"RESTORE\" to proceed." },
      { status: 400 },
    );
  }

  const args = ["/opt/kindred/scripts/restore.sh", snapshot];
  if (body.dry_run) args.push("--dry-run");

  // Restore is short but blocking (~5-15sec service downtime). Allow up to 5 minutes.
  const result = await runBin("bash", args, env, 300000);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `restore.sh exited ${result.exitCode}`,
        stderr: result.stderr.slice(-1024),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, snapshot });
}