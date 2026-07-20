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
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-sand-shadow">Your inner circle</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-night sm:text-4xl">People worth remembering.</h1>
        <p className="mt-3 text-base leading-7 text-night/70">Keep birthdays, little details, and every important date close at hand.</p>
      </div>
      <ContactsClient initialContacts={contacts} feedPath={feedPath} />
    </main>
  );
}
