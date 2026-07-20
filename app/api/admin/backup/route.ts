import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv, runBin } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trigger an ad-hoc backup by running scripts/backup.sh as the kindred
 * user. The script reads /etc/kindred/backup.env via systemd's
 * EnvironmentFile mechanism OR (for ad-hoc invocations) sources it
 * itself — we make sure the env is present, then spawn it.
 *
 * Runs the backup in the background; returns immediately with a polling
 * hint for /api/admin/backup/status.
 */
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

  // Spawn backup.sh detached (no wait) so the HTTP request returns quickly.
  // The script writes its status to journald tagged `kindred-backup`,
  // which /api/admin/backup/status then surfaces.
  try {
    const result = await runBin("bash", ["/opt/kindred/scripts/backup.sh"], env, 300000);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: `backup.sh exited ${result.exitCode}`, stderr: result.stderr.slice(-512) },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}