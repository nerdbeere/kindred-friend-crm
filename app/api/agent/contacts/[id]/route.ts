import { NextRequest, NextResponse } from "next/server";
import {
  daysUntilBirthday,
  deleteContact,
  getContact,
  updateContact,
  validateContact,
} from "@/lib/contacts";
import { isAgentAuthorized } from "@/lib/agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/agent/contacts/<id> — fetch a single contact. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAgentAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseId((await params).id);
  if (id === null)
    return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });

  const contact = getContact(id);
  if (!contact)
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  return NextResponse.json({
    ...contact,
    days_until: daysUntilBirthday(contact.birth_month, contact.birth_day),
  });
}

/** PUT /api/agent/contacts/<id> — replace a contact (full update). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAgentAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseId((await params).id);
  if (id === null)
    return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const error = validateContact(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const contact = updateContact(
    id,
    body as Parameters<typeof updateContact>[1],
  );
  if (!contact)
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  return NextResponse.json(contact);
}

/** DELETE /api/agent/contacts/<id> — permanently delete a contact. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAgentAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseId((await params).id);
  if (id === null)
    return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });

  if (!deleteContact(id))
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
