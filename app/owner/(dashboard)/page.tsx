import { redirect } from "next/navigation";

// /owner → /owner/dashboard
export default function OwnerRootPage() {
  redirect("/owner/dashboard");
}
