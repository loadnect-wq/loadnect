import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { jsonLdGraph, organizationJsonLd } from "@/lib/seo/jsonld";

// /contact is a Client Component and so cannot export metadata itself; this
// server layout supplies it.
export const metadata: Metadata = buildMetadata({
  // See the note in app/owner/register/layout.tsx — the template supplies the
  // brand, so this said "Contact Hallnect | Hallnect".
  title: "Contact Us",
  description:
    "Get in touch with the Hallnect team about a booking, a venue listing or a payment. " +
    "Based in Madurai, serving wedding venues across Tamil Nadu.",
  path: "/contact",
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* /contact is where the name, address, phone, email and support hours
          are actually printed, and it was the one public page publishing them
          with no machine-readable equivalent. The builder reads the same
          constants the page renders, so the markup cannot drift from the
          visible copy — which is the condition that makes it legitimate. */}
      <JsonLd data={jsonLdGraph(organizationJsonLd())} />
      {children}
    </>
  );
}
