import { redirect } from "next/navigation";

// The pricing page lives at /premium. /pricing is a friendly alias so the
// canonical URL and any external "/pricing" links resolve instead of 404-ing.
export default function PricingPage() {
  redirect("/premium");
}
