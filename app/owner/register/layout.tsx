import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

// Client Component page — metadata must live on a server layout.
// This one IS indexable: venue owners search for how to list a hall.
export const metadata: Metadata = buildMetadata({
  title: "List Your Wedding Hall on Hallnect",
  description:
    "List your wedding hall or event venue on Hallnect. Reach couples across Tamil Nadu, " +
    "manage availability and bookings, and receive the advance automatically when you accept.",
  path: "/owner/register",
});

export default function OwnerRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
