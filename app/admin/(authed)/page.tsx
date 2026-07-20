import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** /admin has no content of its own — land on the backups dashboard. */
export default function AdminIndexPage() {
  redirect("/admin/backups");
}
