import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { isAuthenticated, isSameOrigin, verifyAdminPassword, setAdminPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const has = Boolean(getSetting("admin_password_hash"));
  return NextResponse.json({ admin_password_set: has });
}

interface PutBody {
  current_password?: string;
  new_password?: string;
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

  const current = body.current_password || "";
  const next = body.new_password || "";
  if (!current || !next) {
    return NextResponse.json({ error: "current_password and new_password are required." }, { status: 400 });
  }
  if (next.length < 12 || next.length > 1024) {
    return NextResponse.json({ error: "New password must be 12-1024 characters." }, { status: 400 });
  }

  const ok = await verifyAdminPassword(current);
  if (!ok) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  await setAdminPassword(next);
  return NextResponse.json({ ok: true });
}