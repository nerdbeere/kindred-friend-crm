import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminSettingsPage() {
  redirect("/admin/access");
}
