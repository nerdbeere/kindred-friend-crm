import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { isAuthenticated } from "@/lib/auth";
import { loadBackupEnv, resticEnv, resticListFiles, SNAPSHOT_ID_RE } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup/download?snapshot=<id|latest>
 *
 * Stream the snapshot's SQLite DB (decrypted on the server by restic) as a
 * file download. Read-only — nothing on the server changes. Useful for
 * keeping a local copy or inspecting a snapshot without restoring.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) {
    return NextResponse.json({ error: "Backups are not configured." }, { status: 409 });
  }

  const snapshot = (request.nextUrl.searchParams.get("snapshot") || "latest").trim();
  if (snapshot !== "latest" && !SNAPSHOT_ID_RE.test(snapshot)) {
    return NextResponse.json({ error: "Invalid snapshot id." }, { status: 400 });
  }

  // Find the DB file inside the snapshot (path as stored by restic).
  const files = await resticListFiles(snapshot);
  const dbPath = files.find((p) => p.endsWith("snapshot.db")) || files.find((p) => p.endsWith(".db"));
  if (!dbPath) {
    return NextResponse.json({ error: "Snapshot contains no database file." }, { status: 404 });
  }

  const cleanEnv = (await resticEnv()) || {};
  const child = spawn("restic", ["dump", snapshot, dbPath], {
    env: { ...process.env, ...cleanEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const short = snapshot === "latest" ? "latest" : snapshot.slice(0, 8);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let failed = false;
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      child.stdout.on("end", () => {
        if (!failed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
      child.on("error", (err) => {
        failed = true;
        controller.error(err);
      });
      child.on("close", (code) => {
        if (code !== 0 && !failed) {
          failed = true;
          controller.error(new Error(`restic dump exited ${code}: ${stderr.trim().slice(-300)}`));
        }
      });
    },
    cancel() {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="kindred-${short}.db"`,
      "Cache-Control": "no-store",
    },
  });
}
