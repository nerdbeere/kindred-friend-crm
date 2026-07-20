import { NextRequest, NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/db";
import { verifyAdminPassword, issueSessionCookie, isSameOrigin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Setup has not been completed." }, { status: 410 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`login:${ip}`, { max: 5, windowSeconds: 15 * 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many login attempts. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const password = body.password || "";
  if (!password || password.length > 1024) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const ok = await verifyAdminPassword(password);
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

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