import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminSettingsPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
      <p className="mt-1 text-sm text-stone-500">Rotate your admin password.</p>
      <SettingsClient />
    </div>
  );
}