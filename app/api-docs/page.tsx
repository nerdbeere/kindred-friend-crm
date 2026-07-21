import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  // Developer documentation displays the API token, so keep it inside the
  // authenticated admin area rather than exposing it from a public route.
  redirect("/admin/developer");
}
