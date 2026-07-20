import { daysUntilBirthday, fullName, listContacts } from "@/lib/contacts";
import { getFeedToken } from "@/lib/db";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "./components/ui";
import CopyFeedUrlButton from "./CopyFeedUrlButton";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function birthdayLabel(c: { birth_month: number; birth_day: number; birth_year: number | null }): string {
  const base = `${MONTH_NAMES[c.birth_month - 1]} ${c.birth_day}`;
  return c.birth_year ? `${base}, ${c.birth_year}` : base;
}

function untilLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

export default function DashboardPage() {
  const contacts = listContacts()
    .map((c) => ({ ...c, days_until: daysUntilBirthday(c.birth_month, c.birth_day) }))
    .sort((a, b) => a.days_until - b.days_until);
  const feedPath = `/api/feed/${getFeedToken()}.ics`;

  const upcoming = contacts.slice(0, 8);
  const thisWeek = contacts.filter((c) => c.days_until <= 7).length;
  const thisMonth = contacts.filter((c) => c.days_until <= 30).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        eyebrow="Dashboard"
        title="Upcoming birthdays"
        actions={<LinkButton href="/contacts" variant="secondary" size="sm">View all contacts</LinkButton>}
      />

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Card className="p-4 text-center sm:p-5">
          <p className="text-2xl font-bold text-night">{contacts.length}</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-night/50">Contacts</p>
        </Card>
        <Card className="p-4 text-center sm:p-5">
          <p className="text-2xl font-bold text-night">{thisWeek}</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-night/50">Next 7 days</p>
        </Card>
        <Card className="p-4 text-center sm:p-5">
          <p className="text-2xl font-bold text-night">{thisMonth}</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-night/50">Next 30 days</p>
        </Card>
      </div>

      <Card className="mt-6 p-0 sm:p-0">
        {upcoming.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState>
              No contacts yet. <LinkButton href="/contacts" variant="ghost" size="sm" className="ml-1">Add your first person &rarr;</LinkButton>
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-night/10">
            {upcoming.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-4 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate font-bold text-night">{fullName(c)}</p>
                  <p className="text-sm text-night/55">{birthdayLabel(c)}</p>
                </div>
                <Badge tone={c.days_until === 0 ? "accent" : c.days_until <= 30 ? "neutral" : "neutral"}>
                  {untilLabel(c.days_until)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 flex items-center justify-between gap-3 px-1 text-xs text-night/45">
        <span>Subscribe to birthdays from Home Assistant, Google Calendar, or any calendar app.</span>
        <CopyFeedUrlButton feedPath={feedPath} />
      </div>
    </main>
  );
}
