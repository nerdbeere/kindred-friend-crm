import { NextRequest, NextResponse } from "next/server";
import {
  createContact,
  daysUntilBirthday,
  listContacts,
  validateContact,
} from "@/lib/contacts";
import { isAgentAuthorized } from "@/lib/agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/contacts
 *   ?q=<text>          case-insensitive substring match on name and notes
 *   ?within_days=<n>   only contacts whose next birthday is within n days
 *
 * Returns contacts sorted by upcoming birthday, each with a computed
 * `days_until` field.
 */
export async function GET(request: NextRequest) {
  if (!isAgentAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const withinRaw = request.nextUrl.searchParams.get("within_days");
  let withinDays: number | null = null;
  if (withinRaw !== null) {
    const n = Number(withinRaw);
    if (!Number.isInteger(n) || n < 0 || n > 3660)
      return NextResponse.json(
        { error: "within_days must be an integer between 0 and 3660" },
        { status: 400 },
      );
    withinDays = n;
  }

  const contacts = listContacts()
    .map((c) => ({
      ...c,
      days_until: daysUntilBirthday(c.birth_month, c.birth_day),
    }))
    .filter(
      (c) =>
        (q === "" ||
          c.name.toLowerCase().includes(q) ||
          c.notes.toLowerCase().includes(q)) &&
        (withinDays === null || c.days_until <= withinDays),
    );

  return NextResponse.json(contacts);
}

/** POST /api/agent/contacts — create a contact. */
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const error = validateContact(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const contact = createContact(body as Parameters<typeof createContact>[0]);
  return NextResponse.json(contact, { status: 201 });
}
