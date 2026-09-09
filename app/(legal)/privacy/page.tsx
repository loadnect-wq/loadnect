import type { Metadata } from "next";
import { AnalyticsConsentControl } from "./_components/AnalyticsConsentControl";
import { buildMetadata } from "@/lib/seo/metadata";
import { legalUpdatedLabel } from "@/lib/content";
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
      <LegalHeader title="Privacy Policy" updated={legalUpdatedLabel("/privacy")} />

      <Section title="1. Who We Are">
        Hallnect is operated by <strong>{CONTACT.legalName}</strong> (LLPIN {CONTACT.llpin}), a limited liability partnership registered in India under the Limited Liability Partnership Act, 2008, with its registered office at {CONTACT.address}. We act as the data fiduciary for personal information collected through this platform. For privacy concerns, contact us at{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>.
      </Section>

      {/* The usage-data category was REMOVED once, correctly: it described collection
          nothing performed, and declaring collection you do not do is its own DPDP
          problem. The note left behind said "If telemetry is ever added, put the category
          back FIRST." Google Analytics then shipped (2026-09-09) and this list was not
          updated — under-declaring, which is the worse direction of the same error. It is
          back now, and scoped precisely to what actually happens: nothing until consent,
          because components/analytics/AnalyticsConsent.tsx does not put the tag on the
          page until then. Still true that no migration defines an ip or user_agent column
          and that OTP rate limiting keys on phone and account, not IP — so the category is
          third-party only, and says so. */}
      <Section title="2. Information We Collect">
        We collect: account information you provide (name, email, phone number); booking information (event date, hall selected, guests, payment transaction references); and venue owner information (business name, hall details, pricing, photos).
        {" "}
        <strong>Only if you accept analytics</strong>, Google Analytics also collects usage data on our behalf — which pages you visit, the page you arrived from, your device and browser type, and an approximate location derived from your IP address, which we ask Google to anonymise. That data is held by Google, not in our database; we store no page-view, search or IP log of our own. If you decline, or before you answer, none of it is collected at all.
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

      {/* THE CONDITION THIS SECTION SET HAS NOW BEEN MET. It previously said
          analytics must not be mentioned "unless analytics actually ships — and
          if it does, it needs a real consent mechanism before this paragraph can
          mention it". Google Analytics ships behind
          components/analytics/AnalyticsConsent.tsx, which loads nothing at all
          until the visitor accepts, and the control below genuinely clears the
          choice. Every sentence here is checkable against that component; if it
          is ever removed or made to load by default, this paragraph is wrong
          first. */}
      <Section title="6. Cookies">
        <strong>Essential cookies</strong> keep you signed in and maintain your session while you browse and book. They are always on, because without them you cannot book.
        {" "}
        <strong>Analytics are off until you turn them on.</strong> We ask once, in a banner at the bottom of the page. Only if you choose &ldquo;Allow analytics&rdquo; do we load Google Analytics, which tells us which pages people find useful and where they leave. Until you accept, no analytics script is loaded, no request is made to Google, and no analytics cookie is set — the tag is not on the page at all. Your choice is stored in your own browser and is never sent to us. We ask Google to anonymise your IP address, and we do not enable advertising, ad personalisation or remarketing features.
        {" "}
        We do not run any other third-party measurement or advertising scripts. You can change your mind at any time using the button below, and you can block or clear cookies in your browser settings — though doing so will sign you out and prevent you from booking.
      </Section>

      {/* The promise above has to be operable, not merely stated. */}
      <AnalyticsConsentControl />

      {/* KEEP THIS IN STEP WITH THE PRODUCT. This section previously promised
          "account details removed within 30 days", implying a self-service
          control that did not exist; it was rewritten to describe the email
          route, which was the only honest version at the time. The control now
          exists (app/customer/profile/_components/CloseAccount.tsx), so the
          stronger statement is true again — but if that control is ever removed
          or broken, this text comes back down with it. */}
      <Section title="7. Data Retention and Deletion">
        We retain your personal data for as long as your account is active. You can close
        your account yourself from <strong>Profile &rarr; Close my account</strong>: your name,
        email, phone number and saved venues are permanently removed, you can no longer
        sign in, and the account cannot be restored. If you would rather we did it, email{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>{" "}
        from the address registered on the account and we will verify the request and act
        on it within 30 days. Booking and transaction records are retained for 7 years to
        comply with Indian financial recordkeeping laws; these survive account closure and
        cannot be deleted on request, because the law requires us to keep them — but once
        the account is closed nothing identifying you remains attached to them. Reviews you
        left stay visible without your name. An account with a booking in progress or a
        refund still being paid cannot be closed until those are settled, because both
        need a reachable customer.
      </Section>

      <Section title="8. Your Rights">
        Under the <strong>Digital Personal Data Protection Act, 2023</strong> you may ask us for a summary of the personal data we hold about you and the parties it has been shared with; ask us to correct, complete or update inaccurate data; ask us to erase personal data we no longer need for the purpose you gave it for; and nominate another person to exercise these rights on your behalf if you die or become incapacitated. Erasure does not extend to the booking and transaction records we are legally required to retain (see section 7). Closing your account and switching off SMS updates are both self-service in your profile; the remaining requests are handled by email: write to{" "}
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
