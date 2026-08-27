import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Terms and Conditions",
  description:
    "The terms governing use of Hallnect — bookings, advance payments, the flat platform fee, venue owner obligations and platform liability.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <article>
      <LegalHeader title="Terms and Conditions" updated="June 2025" />

      <Section title="1. About Hallnect">
        Hallnect is an online marketplace operated by <strong>HALLNECT LLP</strong> that connects customers looking to book wedding halls and event venues with venue owners listing their properties. Hallnect is a technology platform and{" "}
        <strong>not a venue owner</strong>. We do not own, operate, or control any venues listed on the platform. The booking contract is between the customer and the venue owner.
      </Section>

      <Section title="2. Acceptance of Terms">
        By accessing or using Hallnect — whether as a customer, venue owner, or visitor — you agree to these Terms and Conditions and our Privacy Policy. If you do not agree, please do not use the platform. We may update these terms from time to time; continued use after changes are posted constitutes acceptance.
      </Section>

      <Section title="3. Eligibility">
        You must be at least 18 years old to create an account. By registering, you confirm that the information you provide is accurate and that you have the legal capacity to enter into a contract under Indian law.
      </Section>

      <Section title="4. Bookings, Advance Payment and Platform Fee">
        All bookings on Hallnect require an <strong>advance payment</strong> at checkout to secure the venue and date, plus a flat <strong>₹200 platform fee</strong> collected with the advance. Both amounts are displayed clearly before payment is confirmed. The platform fee is non-refundable except where a cancellation is initiated by the venue or by Hallnect (see the Refund Policy). A booking is not guaranteed until payment is processed and the venue owner confirms the booking. The remaining balance (if any) is settled directly with the venue owner as agreed.
      </Section>

      <Section title="5. Venue Verification">
        <strong>Customers are strongly advised to verify all venue details before confirming a booking and before their event.</strong> This includes capacity, amenities, catering arrangements, parking, décor restrictions, and any other requirements specific to your event. Hallnect displays venue information as provided by owners and does not independently verify every listing detail.
      </Section>

      <Section title="6. Payments">
        All payments are processed through Cashfree Payments. By making a payment, you agree to Cashfree&apos;s terms of service. Hallnect does not store your card number, CVV, or banking credentials. The ₹200 platform fee is collected from the customer together with the advance; Hallnect&apos;s service commission is settled with the venue owner out of the advance and is never an additional customer charge.
      </Section>

      <Section title="7. Hall Owner Obligations">
        Owners must provide accurate listing information including capacity, pricing, amenities, and availability. Owners must honour confirmed bookings. Owner-initiated cancellations must be communicated immediately and may result in penalties. Owners may not collect payments outside the Hallnect platform for bookings originated through Hallnect.
      </Section>

      <Section title="8. Customer Obligations">
        Customers must use booked venues lawfully and in accordance with the venue owner&apos;s rules. Any damage caused during an event is the responsibility of the booking customer. Customers must not attempt to transact directly with owners to circumvent platform fees.
      </Section>

      <Section title="9. Cancellations and Refunds">
        Cancellation and refund terms are detailed in our{" "}
        <a href="/cancellation-policy" className="text-maroon-600 hover:underline">Cancellation Policy</a> and{" "}
        <a href="/refund-policy" className="text-maroon-600 hover:underline">Refund Policy</a>. These apply to both customers and venue owners.
      </Section>

      <Section title="10. Reviews">
        Customers may leave reviews only for venues they have booked through Hallnect, and only after the booking is marked completed. Reviews must be honest and factual. Hallnect reserves the right to hide or remove reviews that violate community guidelines.
      </Section>

      <Section title="11. Prohibited Conduct">
        You agree not to: use the platform for any unlawful purpose; post false or misleading listings or reviews; harass, threaten, or abuse other users; use automated tools to scrape data from the platform; or impersonate any person or entity.
      </Section>

      <Section title="12. Intellectual Property">
        All content on the platform — including logos, text, graphics, and software — is the property of Hallnect or its licensors. You may not reproduce or distribute any content without written permission.
      </Section>

      <Section title="13. Limitation of Liability">
        To the maximum extent permitted by Indian law, Hallnect is not liable for: any loss arising from a venue owner&apos;s failure to honour a booking; inaccuracies in venue listings or photos; or any indirect, incidental, or consequential damages arising from use of the platform. Our total liability is limited to the amount you paid us for the specific booking giving rise to the claim.
      </Section>

      <Section title="14. Governing Law">
        These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of <strong>Madurai, Tamil Nadu</strong>.
      </Section>

      <Section title="15. Contact">
        For questions about these Terms, contact us at{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>{" "}
        or through our <a href="/contact" className="text-maroon-600 hover:underline">Contact page</a>.
      </Section>
    </article>
  );
}

function LegalHeader({ title, updated }: { title: string; updated: string }) {
  return (
    <div className="mb-10 border-b border-border pb-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">Hallnect Legal</p>
      <h1 className="mt-2 font-serif text-3xl font-bold text-charcoal-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-serif text-lg font-semibold text-charcoal-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</p>
    </section>
  );
}
