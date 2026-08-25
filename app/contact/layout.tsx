import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

// /contact is a Client Component and so cannot export metadata itself; this
// server layout supplies it.
export const metadata: Metadata = buildMetadata({
  title: "Contact Hallnect",
  description:
    "Get in touch with the Hallnect team about a booking, a venue listing or a payment. " +
    "Based in Madurai, serving wedding venues across Tamil Nadu.",
  path: "/contact",
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
