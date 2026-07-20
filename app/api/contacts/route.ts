import { NextRequest, NextResponse } from "next/server";
import {
  createContact,
  daysUntilBirthday,
  listContacts,
  validateContact,
} from "@/lib/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const contacts = listContacts().map((c) => ({
    ...c,
    days_until: daysUntilBirthday(c.birth_month, c.birth_day),
  }));
  return NextResponse.json(contacts);
}

export async function POST(request: NextRequest) {
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
