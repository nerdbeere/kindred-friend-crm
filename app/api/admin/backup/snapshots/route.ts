import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resticSnapshots } from "@/lib/backup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const snapshots = await resticSnapshots();
  return NextResponse.json({ snapshots });
}