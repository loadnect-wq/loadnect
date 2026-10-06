import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { legalUpdatedLabel } from "@/lib/content";

export const metadata: Metadata = buildMetadata({
  title: "Terms and Conditions",
  description:
    "The terms governing use of Hallnect — requests for quotes, bookings arranged with venues, venue owner subscriptions and obligations, and platform liability.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <article>
      <LegalHeader title="Terms and Conditions" updated={legalUpdatedLabel("/terms")} />

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

      {/* ONLINE BOOKING WAS SWITCHED OFF ON 2026-10-05 (migration 0112). This
          section used to describe an advance paid at checkout plus a platform
          fee; that text is in git history and must come back, reviewed, before
          lib/booking-switch.ts is turned on again. */}
      <Section title="4. Requests for Quotes and Bookings">
        Venues on Hallnect take <strong>requests for quotes</strong>. You tell a venue your date and needs; the venue replies on Hallnect with a quote — its price, what is included, any advance it asks for, and how long the offer stands. The venue sees your name and event details, but <strong>not your phone number</strong>, until you accept its quote; only then is your verified number shared with that venue so it can call you. You agree the booking directly with the venue, and any advance and the balance are paid to the venue, not to Hallnect. Hallnect charges you nothing. A date is not held for you until the venue confirms the booking with you. Online booking with an advance paid through Hallnect is not currently offered.
      </Section>

      <Section title="5. Venue Verification">
        <strong>Customers are strongly advised to verify all venue details before confirming a booking and before their event.</strong> This includes capacity, amenities, catering arrangements, parking, décor restrictions, and any other requirements specific to your event. Hallnect displays venue information as provided by owners and does not independently verify every listing detail.
      </Section>

      <Section title="6. Payments">
        Payments made on Hallnect — venue owners&apos; subscriptions and the commission a venue owes Hallnect on a booking it confirms — are processed through Cashfree Payments. By making a payment, you agree to Cashfree&apos;s terms of service. Hallnect does not store your card number, CVV, or banking credentials. Hallnect&apos;s commission is billed to the venue owner and is never a charge to the customer.
      </Section>

      <Section title="7. Venue Owner Subscriptions (Pro and Elite)">
        Venue owners may subscribe a hall to a paid listing plan. These plans are{" "}
        <strong>recurring monthly subscriptions</strong>, not one-off purchases.
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>
            Current prices are <strong>&#8377;4,999 per month</strong> for Pro and{" "}
            <strong>&#8377;9,999 per month</strong> for Elite, charged <strong>per hall</strong>.
            The price shown on the plans page at the time you subscribe is the price that applies.
          </li>
          <li>
            The <strong>first month is charged immediately</strong> when you subscribe, and your
            listing is promoted straight away.
          </li>
          <li>
            You authorise a <strong>standing instruction (UPI AutoPay or card mandate)</strong>{" "}
            through our payment provider, Cashfree. The same amount is then charged{" "}
            <strong>automatically every month</strong> until you cancel. We cannot charge more than
            the amount you approved.
          </li>
          <li>
            <strong>You can cancel at any time</strong> from Owner Dashboard &rarr; Premium &rarr;
            &ldquo;Cancel monthly renewal&rdquo;. Cancelling stops all future charges immediately.
          </li>
          <li>
            Cancelling does <strong>not</strong> refund the month already paid for. Your listing
            stays promoted until the end of the period you have paid for, and then simply stops.
            Part-months are not refunded.
          </li>
          <li>
            If a monthly payment fails, the promotion ends when the paid period ends. We do not
            retry indefinitely and we do not charge you for a period you were not promoted for.
          </li>
          <li>
            A subscription buys <strong>placement and badging only</strong>. It does not guarantee
            bookings, enquiries, or any level of revenue.
          </li>
        </ul>
      </Section>

      <Section title="8. Hall Owner Obligations">
        Owners must provide accurate listing information including capacity, pricing, amenities, and availability. Owners must honour confirmed bookings. Owner-initiated cancellations must be communicated immediately and may result in penalties. Owners must use a customer&apos;s phone number only to arrange the booking the customer asked about, and must mark a booking that came through Hallnect as booked, at the amount agreed, so that the commission due on it can be billed.
      </Section>

      <Section title="9. Customer Obligations">
        Customers must use booked venues lawfully and in accordance with the venue owner&apos;s rules. Any damage caused during an event is the responsibility of the booking customer. Customers must give accurate event details when they ask a venue for a quote.
      </Section>

      <Section title="10. Cancellations and Refunds">
        Cancellation and refund terms are detailed in our{" "}
        <a href="/cancellation-policy" className="text-maroon-600 hover:underline">Cancellation Policy</a> and{" "}
        <a href="/refund-policy" className="text-maroon-600 hover:underline">Refund Policy</a>. These apply to both customers and venue owners.
      </Section>

      <Section title="11. Reviews">
        Customers may leave reviews only for venues they have booked through Hallnect, and only after the booking is marked completed. Reviews must be honest and factual. Hallnect reserves the right to hide or remove reviews that violate community guidelines.
      </Section>

      <Section title="12. Prohibited Conduct">
        You agree not to: use the platform for any unlawful purpose; post false or misleading listings or reviews; harass, threaten, or abuse other users; use automated tools to scrape data from the platform; or impersonate any person or entity.
      </Section>

      <Section title="13. Intellectual Property">
        All content on the platform — including logos, text, graphics, and software — is the property of Hallnect or its licensors. You may not reproduce or distribute any content without written permission.
      </Section>

      <Section title="14. Limitation of Liability">
        To the maximum extent permitted by Indian law, Hallnect is not liable for: any loss arising from a venue owner&apos;s failure to honour a booking; inaccuracies in venue listings or photos; or any indirect, incidental, or consequential damages arising from use of the platform. Our total liability is limited to the amount you paid us for the specific booking giving rise to the claim.
      </Section>

      <Section title="15. Governing Law">
        These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of <strong>Madurai, Tamil Nadu</strong>.
      </Section>

      {/* These timelines must be the SHORTER pair, and must match
          /grievance-redressal word for word. Two clocks were published at once:
          48 hours / one month here, 24 hours / 15 days there. A customer
          chasing a refund reads whichever page they landed on, and the slower
          promise is the one we would have been held to having advertised. The
          Grievance page explains why the shorter pair governs — Hallnect is
          both an e-commerce entity and an intermediary, and the intermediary
          clock is tighter. Change one of these two pages and you change both. */}
      <Section title="16. Grievance Redressal">
        We have appointed a grievance officer under Rule 4(4) of the Consumer Protection
        (E-Commerce) Rules, 2020 and Rule 3(2)(a) of the Information Technology
        (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021. Their name,
        designation and contact details, along with the timelines we commit to —
        acknowledgement within 24 hours and resolution within 15 days — are published on our{" "}
        <a href="/grievance-redressal" className="text-maroon-600 hover:underline">Grievance Redressal</a>{" "}
        page. Nothing in these Terms limits your rights under the Consumer Protection Act, 2019.
      </Section>

      <Section title="17. Contact">
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
      <p className="text-xs font-semibold uppercase tracking-widest text-gold-700">Hallnect Legal</p>
      <h1 className="mt-2 font-serif text-3xl font-bold text-charcoal-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-serif text-lg font-semibold text-charcoal-900">{title}</h2>
      {/* Must stay a <div>. Section 7 passes a <ul>, which a <p> cannot legally contain:
          the browser closes the paragraph before the list and reparents it, so the DOM
          stops matching the server HTML and React throws a hydration error — on the very
          page the checkout's mandatory consent checkbox links to. Tailwind's preflight
          zeroes paragraph margins, so this renders identically to the old <p>. */}
      <div className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</div>
    </section>
  );
}
