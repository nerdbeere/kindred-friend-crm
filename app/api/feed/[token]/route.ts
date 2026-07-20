import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getFeedToken } from "@/lib/db";
import { buildBirthdayCalendar } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/feed/<token> or /api/feed/<token>.ics
 *
 * Token-only access (no other auth): the secret in the URL is the credential,
 * so Home Assistant can poll the feed directly. The ".ics" suffix is stripped
 * before comparison so both URL forms work.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const raw = (await params).token;
  const token = raw.replace(/\.ics$/i, "");

  const expected = getFeedToken();
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  const valid =
    tokenBuf.length === expectedBuf.length &&
    timingSafeEqual(tokenBuf, expectedBuf);

  if (!valid) {
    return new NextResponse("Not found", { status: 404 });
  }

  const calendar = buildBirthdayCalendar();
  return new NextResponse(calendar, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="birthdays.ics"',
      "Cache-Control": "no-store",
    },
  });
}
