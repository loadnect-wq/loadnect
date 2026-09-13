import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

// Client Component page — metadata must live on a server layout.
// This one IS indexable: venue owners search for how to list a hall.
export const metadata: Metadata = buildMetadata({
  // No brand in the page-owned half: the root layout's title.template appends
  // " | Hallnect" and this read "List Your Wedding Hall on Hallnect | Hallnect".
  title: "List Your Wedding Hall or Event Venue",
  // NB: no payout-timing claim. The automatic split is built but not yet
  // enabled at the gateway, and a description is a promise Google will quote.
  description:
    "List your wedding hall or event venue on Hallnect for free. Reach couples across " +
    "Tamil Nadu, approve every booking yourself, and pay one commission.",
  path: "/owner/register",
});

export default function OwnerRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
