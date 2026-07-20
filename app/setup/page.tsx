import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import { PageHeader } from "@/app/components/ui";
import SetupWizard from "./SetupWizard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function SetupPage() {
  if (isAdminConfigured()) {
    // Setup window has closed — send the user back to the home page.
    redirect("/");
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="First-time setup"
        title="Welcome to Kindred"
        description="Create your admin account. Takes about a minute."
      />
      <SetupWizard />
    </main>
  );
}