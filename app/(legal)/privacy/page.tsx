import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { CONTACT } from "@/lib/constants";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Hallnect collects, uses and protects your personal data — what we store for bookings, who we share it with, and how to request deletion.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <article>
      <LegalHeader title="Privacy Policy" updated="August 2026" />

      <Section title="1. Who We Are">
        Hallnect is operated by <strong>{CONTACT.legalName}</strong> (LLPIN {CONTACT.llpin}), a limited liability partnership registered in India under the Limited Liability Partnership Act, 2008, with its registered office at {CONTACT.address}. We act as the data fiduciary for personal information collected through this platform. For privacy concerns, contact us at{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>.
      </Section>

      {/* This list claimed a fourth category — "usage data (pages visited, search queries,
          device type, IP address for security)" — that nothing collects. There is no
          analytics package, no page-view or search logging, and no migration defines an ip
          or user_agent column anywhere; even OTP rate limiting keys on phone and account,
          not IP. Declaring collection we do not perform is its own DPDP problem, so the
          category is gone. If telemetry is ever added, put the category back FIRST. */}
      <Section title="2. Information We Collect">
        We collect: account information you provide (name, email, phone number); booking information (event date, hall selected, guests, payment transaction references); and venue owner information (business name, hall details, pricing, photos).
      </Section>

      <Section title="3. How We Use Your Information">
        We use your information to process bookings and facilitate communication between customers and venue owners; to verify your identity and maintain account security; to process payments and issue refunds through Cashfree Payments; to send booking confirmations, reminders, and support responses; to display your reviews on venue pages; and to comply with legal obligations under Indian law. We do not sell your personal data to third parties.
      </Section>

      <Section title="4. Payment Data">
        <p>
          Payment processing is handled by Cashfree Payments. Hallnect does not store your card number, CVV, UPI PIN or net-banking credentials. For a customer booking we retain only the transaction reference and the amounts involved.
        </p>
        <p className="mt-3">
          <strong>Venue owners.</strong> To pay you for bookings we collect and store your PAN, and the payout destination you provide — bank account number and IFSC, or UPI ID — together with your business name, email and phone. These are shared with Cashfree Payments to create your payout account, and are used for no other purpose. They are visible to you in your owner profile and to Hallnect staff who administer payouts. You can change them at any time; ask us and we will delete them, though we cannot pay you automatically without them.
        </p>
      </Section>

      <Section title="5. Data Sharing">
        We share your information only with: (a) venue owners to fulfil your confirmed booking — your name and contact details are shared so the owner can prepare for your event; (b) Cashfree Payments for transaction processing, and for venue owners the payout and identity details listed in section 4 so that settlements can be made; (b-i) MSG91, our SMS provider, to deliver booking notifications and one-time verification codes to the phone number you gave us; (c) cloud infrastructure and email delivery service providers under strict confidentiality agreements; and (d) law enforcement when required by a valid legal order. Venue owners may not use customer contact details for any purpose other than fulfilling the specific booking.
      </Section>

      {/* This section used to claim analytics cookies and a cookie-preferences control.
          Neither exists: there is no analytics or tag script in the app, no third-party
          measurement SDK, and no consent banner to express a preference through. Promising
          an opt-out we never built is worse than having no analytics at all. Do not restore
          the analytics sentence unless analytics actually ships — and if it does, it needs
          a real consent mechanism before this paragraph can mention it. */}
      <Section title="6. Cookies">
        We use <strong>essential cookies only</strong> — they keep you signed in and maintain your session while you browse and book. We do not use analytics, advertising or tracking cookies, and we do not run any third-party measurement or advertising scripts on this site. Because every cookie we set is strictly necessary, there is no cookie consent banner and nothing to opt out of. You can block or clear cookies in your browser settings, but doing so will sign you out and prevent you from booking.
      </Section>

      {/* The old text said "after account deletion, account details are removed within 30
          days" — which reads as if the platform has a delete-account button. It does not:
          there is no such control in the customer or owner profile, and no code path
          anywhere deletes a user. Describing the manual email route is the only honest
          version until that feature is actually built. If you build it, say so here and
          point at it; until then do not imply a self-service control exists. */}
      <Section title="7. Data Retention and Deletion">
        We retain your personal data for as long as your account is active. There is currently no delete-account button in the app — to close your account, email{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>{" "}
        from the address registered on the account, and we will verify the request and remove your account details within 30 days. Booking and transaction records are retained for 7 years to comply with Indian financial recordkeeping laws; these survive account closure and cannot be deleted on request, because the law requires us to keep them.
      </Section>

      <Section title="8. Your Rights">
        Under the <strong>Digital Personal Data Protection Act, 2023</strong> you may ask us for a summary of the personal data we hold about you and the parties it has been shared with; ask us to correct, complete or update inaccurate data; ask us to erase personal data we no longer need for the purpose you gave it for; and nominate another person to exercise these rights on your behalf if you die or become incapacitated. Erasure does not extend to the booking and transaction records we are legally required to retain (see section 7). Except for the SMS updates toggle in your profile, which you can switch off yourself at any time, these requests are handled by email rather than by an in-app control: write to{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>{" "}
        and we will respond within 30 days. If you are not satisfied with our response, you may escalate to our{" "}
        <a href="/grievance-redressal" className="text-maroon-600 hover:underline">Grievance Officer</a>, and after that to the Data Protection Board of India.
      </Section>

      <Section title="9. Security">
        We use industry-standard security measures including encrypted connections (HTTPS/TLS), Row Level Security on all database tables, and access controls. No internet transmission method is 100% secure. Report suspected unauthorised access to{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>.
      </Section>

      <Section title="10. Children">
        Hallnect is not directed at users under 18 years of age. We do not knowingly collect personal information from minors. If we become aware of such data, we will delete it promptly.
      </Section>

      <Section title="11. Changes">
        We may update this Privacy Policy periodically. Material changes will be notified by email or a prominent notice on the platform. Continued use after changes are effective constitutes acceptance.
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
      {/* Must stay a <div>. Section 4 passes two <p> elements, which a <p> cannot legally
          contain: the browser closes the outer paragraph before them and reparents them,
          so the DOM stops matching the server HTML and React throws a hydration error —
          on a page the checkout's mandatory consent checkbox links to. Tailwind's
          preflight zeroes paragraph margins, so this renders identically to the old <p>. */}
      <div className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</div>
    </section>
  );
}
