import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

// Client Component page — metadata must live on a server layout.
// This one IS indexable: venue owners search for how to list a hall.
export const metadata: Metadata = buildMetadata({
  title: "List Your Wedding Hall on Hallnect",
  // NB: no payout-timing claim. The automatic split is built but not yet
  // enabled at the gateway, and a description is a promise Google will quote.
  description:
    "List your wedding hall or event venue on Hallnect for free. Reach couples across " +
    "Tamil Nadu, approve every booking yourself, and keep 97.5% of the hall price — " +
    "one commission, taken from the advance, with no bill and no monthly fee.",
  path: "/owner/register",
});

export default function OwnerRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
