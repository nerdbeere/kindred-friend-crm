import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { resticSnapshots, resticForgetSnapshot, SNAPSHOT_ID_RE } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const snapshots = await resticSnapshots();
  return NextResponse.json({ snapshots });
}

/**
 * DELETE — forget a snapshot and prune its now-unreferenced data.
 * Body: { snapshot: "<id>", confirm: "DELETE" }. The typed confirmation is
 * required because pruning is irreversible.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: { snapshot?: string; confirm?: string };
  try {
    body = (await request.json()) as { snapshot?: string; confirm?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const snapshot = (body.snapshot || "").trim();
  if (!SNAPSHOT_ID_RE.test(snapshot)) {
    return NextResponse.json({ error: "Invalid snapshot id." }, { status: 400 });
  }
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Confirmation required. Re-send with confirm: \"DELETE\" to proceed." },
      { status: 400 },
    );
  }

  const result = await resticForgetSnapshot(snapshot);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || "restic forget failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, snapshot });
}
