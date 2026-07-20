import { NextRequest, NextResponse } from "next/server";
import {
  deleteContact,
  updateContact,
  validateContact,
} from "@/lib/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null)
    return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });

  if (!deleteContact(id))
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
