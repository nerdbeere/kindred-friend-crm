import { createEvents, type DateArray, type EventAttributes } from "ics";
import { listContacts } from "./contacts";

/** Next calendar day as a [year, month, day] tuple (handles month/year rollover). */
function nextDay(year: number, month: number, day: number): DateArray {
  const d = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/**
 * Builds an ICS calendar string with one all-day, yearly-recurring event
 * per contact birthday. Regenerated from current DB data on every call.
 *
 * Contacts without a birth year use the leap year 2000 as the DTSTART anchor
 * so Feb 29 birthdays keep a valid yearly recurrence.
 */
export function buildBirthdayCalendar(): string {
  const contacts = listContacts();

  const events: EventAttributes[] = contacts.map((c) => {
    const startYear = c.birth_year ?? 2000;
    const descriptionLines: string[] = [];
    if (c.birth_year) descriptionLines.push(`Born ${c.birth_year}`);
    if (c.notes) descriptionLines.push(c.notes);

    return {
      uid: `kindred-contact-${c.id}@kindred`,
      title: `${c.name} — Birthday`,
      start: [startYear, c.birth_month, c.birth_day],
      end: nextDay(startYear, c.birth_month, c.birth_day),
      recurrenceRule: "FREQ=YEARLY;INTERVAL=1",
      ...(descriptionLines.length > 0
        ? { description: descriptionLines.join("\n") }
        : {}),
      status: "CONFIRMED",
      transp: "TRANSPARENT",
      calName: "Kindred Birthdays",
      productId: "kindred-friend-crm",
    };
  });

  const { error, value } = createEvents(events);
  if (error) throw error;
  return value!;
}
