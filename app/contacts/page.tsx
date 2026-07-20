import { daysUntilBirthday, listContacts } from "@/lib/contacts";
import ContactsClient, { type ContactView } from "./ContactsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kindred — Contacts",
};

export default function ContactsPage() {
  const contacts: ContactView[] = listContacts().map((c) => ({
    ...c,
    days_until: daysUntilBirthday(c.birth_month, c.birth_day),
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <ContactsClient initialContacts={contacts} />
    </main>
  );
}
