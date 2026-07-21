import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  // API reference and access-token handling now live in authenticated Admin.
  redirect("/admin/developer");
}
