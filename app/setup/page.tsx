import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import SetupWizard from "./SetupWizard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function SetupPage() {
  if (isAdminConfigured()) {
    // Setup window has closed — send the user back to the home page.
    redirect("/");
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome to Kindred</h1>
      <p className="mt-1 text-sm text-stone-500">
        First-time setup — create your admin account. Takes about a minute.
      </p>
      <SetupWizard />
    </main>
  );
}