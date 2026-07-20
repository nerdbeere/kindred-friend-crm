import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { applyBackupConfig } from "@/lib/backup-apply";
import { isAdminConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnableBody {
  endpoint?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  access_key_id?: string;
  secret_access_key?: string;
  restic_password?: string | null;
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Setup has not been completed." }, { status: 410 });
  }
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: EnableBody;
  try {
    body = (await request.json()) as EnableBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const required = ["endpoint", "bucket", "prefix", "access_key_id", "secret_access_key"] as const;
  for (const k of required) {
    if (typeof body[k] !== "string" || (body[k] as string).length === 0) {
      return NextResponse.json({ error: `Missing or empty field: ${k}` }, { status: 400 });
    }
  }
  if (!body.endpoint || !body.endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "Endpoint must start with https://." }, { status: 400 });
  }

  const result = await applyBackupConfig({
    endpoint: body.endpoint!,
    bucket: body.bucket!,
    prefix: body.prefix!,
    region: body.region || "",
    access_key_id: body.access_key_id!,
    secret_access_key: body.secret_access_key!,
    restic_password: body.restic_password || null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    repository: result.repository,
    first_backup: result.first_backup,
  });
}