import { daysUntilBirthday, listContacts } from "@/lib/contacts";
import { getFeedToken } from "@/lib/db";
import ContactsClient, { type ContactView } from "./ContactsClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const contacts: ContactView[] = listContacts().map((c) => ({
    ...c,
    days_until: daysUntilBirthday(c.birth_month, c.birth_day),
  }));
  const feedPath = `/api/feed/${getFeedToken()}.ics`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Kindred</h1>
      <p className="mt-1 text-sm text-stone-500">
        Your people, their birthdays, one calendar feed.
      </p>
      <ContactsClient initialContacts={contacts} feedPath={feedPath} />
    </main>
  );
}
