import type { Metadata } from "next";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { buildMetadata } from "@/lib/seo/metadata";
import { legalUpdatedLabel } from "@/lib/content";

export const metadata: Metadata = buildMetadata({
  title: "Refund Policy",
  description:
    "When a Hallnect booking advance is refundable, the cancellation refund schedule, and how the platform fee and its GST are treated.",
  path: "/refund-policy",
});

export default function RefundPolicyPage() {
  return (
    <article>
      <LegalHeader title="Refund Policy" updated={legalUpdatedLabel("/refund-policy")} />

      <Section title="1. Overview">
        Hallnect is a marketplace connecting customers with venue owners. All bookings require an{" "}
        <strong>advance payment</strong> at checkout to secure the venue and date. Refunds follow the single Hallnect schedule below — venues do not set their own cancellation terms. The specific refund amount applicable to your booking is shown on the booking detail page. We strongly recommend reading these terms before paying the advance.
      </Section>

      <Section title="2. Advance Payment">
        The advance amount is shown clearly during checkout before payment is made. By paying the advance, you acknowledge and accept the refund schedule below. The remaining balance (if any) is due to the venue owner directly as agreed, and is outside Hallnect&apos;s refund scope.
      </Section>

      <Section title="3. Customer-Initiated Cancellations">
        Refunds depend on how far in advance you cancel relative to the event date. Whatever
        the schedule does not return to you is <strong>retained by Hallnect</strong> — it is not
        passed on to the venue. It covers the date held exclusively for you, the payment
        processing already incurred, and the bookings the venue declined while your date was
        blocked. If the venue or Hallnect cancels, none of this applies and you are refunded
        in full, platform fee included.
      </Section>

      <div className="my-6 overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-ivory-100">
              <th className="px-4 py-3 text-left font-semibold text-charcoal-800">Cancellation Window</th>
              <th className="px-4 py-3 text-left font-semibold text-charcoal-800">Refund on Advance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-charcoal-600">
            {/* These cells used to read "Up to 100% (subject to owner policy)" and so on.
                That contradicted section 1 and the footnote directly below, both of which
                promise one Hallnect-wide schedule with no owner-set terms — and there is no
                per-owner refund rule anywhere in the code to be "subject to". A customer
                reading "up to" and "subject to owner policy" would reasonably expect to be
                offered less than the table says. State the single figure that actually
                applies; do not reintroduce a hedge the product cannot honour. */}
            <tr>
              <td className="px-4 py-3">More than 30 days before event</td>
              <td className="px-4 py-3 font-medium text-green-700">100% of the advance</td>
            </tr>
            <tr>
              <td className="px-4 py-3">15–30 days before event</td>
              <td className="px-4 py-3 font-medium text-amber-700">75% of the advance</td>
            </tr>
            <tr>
              <td className="px-4 py-3">7–14 days before event</td>
              <td className="px-4 py-3 font-medium text-amber-700">50% of the advance</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Less than 7 days before event</td>
              <td className="px-4 py-3 font-medium text-red-700">No refund</td>
            </tr>
          </tbody>
        </table>
        {/* The schedule says what comes BACK. It has to say where the rest goes,
            or the most contested figure on the page is the unstated one — see
            /cancellation-policy §3 and lib/refunds.ts, which must agree. */}
        <p className="px-4 py-3 text-[11px] text-charcoal-400 border-t border-border">
          This schedule applies to every booking on Hallnect. Venues do not set their own
          cancellation terms. Any part of the advance not refunded to you is retained by
          Hallnect and is not paid to the venue.
        </p>
      </div>

      <Section title="4. Platform Fee">
        Hallnect charges a <strong>{platformFeeDisclosure()}</strong> on each booking, collected together with the advance and disclosed at checkout before payment is confirmed. On a small booking the fee is capped at 25% of the advance, so it may be less. A promotional code may reduce it to ₹0, in which case there is nothing to refund or retain. The fee and its GST are <strong>non-refundable for customer-initiated cancellations</strong> — the refund schedule above applies to the advance only. For owner-initiated cancellations (see section 6), the platform fee is refunded in full.
      </Section>

      <Section title="5. Venue Owner Subscriptions">
        Pro and Elite listing plans are <strong>recurring monthly subscriptions</strong> for venue
        owners and are <strong>separate from booking refunds</strong>. The first month is charged
        when you subscribe. You may cancel at any time from Owner Dashboard &rarr; Premium, which
        stops all future charges immediately. <strong>Months already paid for are not refunded</strong>{" "}
        — your listing stays promoted until the end of the paid period and then stops. Part-months
        are not refunded. If we charge you in error, contact us and we will refund it in full.
      </Section>

      <Section title="6. Owner-Initiated Cancellations">
        If a hall owner cancels a confirmed booking, you are entitled to a full refund of the advance payment including the platform fee. Refunds in this case are processed within 5–7 business days. Repeated owner cancellations may result in suspension of the venue from the platform.
      </Section>

      <Section title="7. How to Request a Refund">
        Log in to your Hallnect account and go to My Bookings. Select the booking and use the Cancel Booking option (if within the cancellation window). Alternatively, email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a> with your booking reference number. We will confirm the eligible refund amount based on the schedule above and the timing of your request.
      </Section>

      {/* "How to Request a Refund" above and this section were both numbered 7, which
          left Disputes and Changes one short at 8 and 9. Everything from here down was
          shifted up by one so the numbering is contiguous and a citation to "section 9"
          of this policy resolves to a single section. */}
      {/* THE REFUND WINDOW IS PUBLISHED IN FIVE PLACES AND THEY MUST AGREE.
          Here, section 7 (owner-cancelled) above, Cancellation Policy section 4,
          and twice in the cancel dialog (CancelButton.tsx) — which is the one a
          customer actually reads, at the moment they are deciding. Change one
          and you have published two different promises about the same money.

          It is also the number REFUND_OVERDUE_DAYS in the nightly sweep is
          derived from: the alarm has to fire while this window can still be
          kept, so tightening this without tightening that leaves the promise
          unwatched. */}
      <Section title="8. Refund Processing Time">
        Approved refunds are processed within <strong>5–7 business days</strong> to the original payment method. Bank processing times may add additional delays beyond our control.
      </Section>

      {/* The response window here and in the Cancellation Policy's dispute section must
          stay the same number. They said 5 and 7 business days respectively for the same
          dispute, so whichever page a customer read set a different expectation. Aligned
          on 7 business days — the slower of the two, because promising the faster one and
          missing it is the failure that actually costs us. Change both or neither. */}
      <Section title="9. Disputes">
        If you believe a refund was incorrectly denied, raise a support ticket through your account or email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a> within 7 days of the cancellation decision. We will review and respond within 7 business days. Hallnect&apos;s decision on refund disputes, after review, is final within Hallnect&apos;s internal process; this does not affect your rights under the Consumer Protection Act, 2019.
      </Section>

      <Section title="10. Changes to This Policy">
        We may update this Refund Policy at any time. The policy applicable to your booking is the one in effect at the time the booking was confirmed.
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
      {/* This wrapper is a <div>, not a <p>, and must stay one. Sections on the sibling
          legal pages pass block content (Terms 7 passes a <ul>, Privacy 4 passes <p>s)
          and a <p> cannot legally contain those — the browser closes the paragraph early
          and reparents them, so the DOM it builds no longer matches the server HTML and
          React throws a hydration error on pages the checkout consent checkbox links to.
          Every legal page carries its own copy of this helper; keep them identical.
          Tailwind's preflight zeroes paragraph margins, so div and p render the same. */}
      <div className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</div>
    </section>
  );
}
