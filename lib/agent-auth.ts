import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { getFeedToken } from "./db";

/**
 * Bearer-token auth for the /api/agent/* endpoints.
 *
 * The agent API reuses the ICS feed token as its single machine-to-machine
 * credential (same "one shared secret" model as the feed). Clients send it
 * as `Authorization: Bearer <token>`; the comparison is constant-time.
 */
export function isAgentAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;

  const token = header.slice("Bearer ".length).trim();
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(getFeedToken());
  return (
    tokenBuf.length === expectedBuf.length &&
    timingSafeEqual(tokenBuf, expectedBuf)
  );
}
