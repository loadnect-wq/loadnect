import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Refund Policy",
  description:
    "When a Hallnect booking advance is refundable, the cancellation refund schedule, and how the flat platform fee is treated on customer and venue cancellations.",
  path: "/refund-policy",
});

export default function RefundPolicyPage() {
  return (
    <article>
      <LegalHeader title="Refund Policy" updated="August 2026" />

      <Section title="1. Overview">
        Hallnect is a marketplace connecting customers with venue owners. All bookings require an{" "}
        <strong>advance payment</strong> at checkout to secure the venue and date. Refunds for bookings are subject to the venue owner&apos;s cancellation terms and the schedule below. The specific refund amount applicable to your booking is shown on the booking detail page. We strongly recommend reading these terms before paying the advance.
      </Section>

      <Section title="2. Advance Payment">
        The advance amount is shown clearly during checkout before payment is made. By paying the advance, you acknowledge and accept the refund schedule below. The remaining balance (if any) is due to the venue owner directly as agreed, and is outside Hallnect&apos;s refund scope.
      </Section>

      <Section title="3. Customer-Initiated Cancellations">
        Refunds depend on how far in advance you cancel relative to the event date:
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
            <tr>
              <td className="px-4 py-3">More than 30 days before event</td>
              <td className="px-4 py-3 font-medium text-green-700">Up to 100% (subject to owner policy)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">15–30 days before event</td>
              <td className="px-4 py-3 font-medium text-amber-700">Up to 75% (subject to owner policy)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">7–14 days before event</td>
              <td className="px-4 py-3 font-medium text-amber-700">Up to 50% (subject to owner policy)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Less than 7 days before event</td>
              <td className="px-4 py-3 font-medium text-red-700">No refund (standard policy)</td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-3 text-[11px] text-charcoal-400 border-t border-border">
          This schedule applies to every booking on Hallnect. Venues do not set their own
          cancellation terms.
        </p>
      </div>

      <Section title="4. Platform Fee">
        Hallnect charges a flat <strong>₹200 platform fee</strong> on each booking, collected together with the advance and disclosed at checkout before payment is confirmed. This fee is <strong>non-refundable for customer-initiated cancellations</strong> — the refund schedule above applies to the advance only. For owner-initiated cancellations (see section 6), the platform fee is refunded in full.
      </Section>

      <Section title="5. Venue Owner Subscriptions">
        Premium and Pro listing plans are <strong>recurring monthly subscriptions</strong> for venue
        owners and are <strong>separate from booking refunds</strong>. The first month is charged
        when you subscribe. You may cancel at any time from Owner Dashboard &rarr; Premium, which
        stops all future charges immediately. <strong>Months already paid for are not refunded</strong>{" "}
        — your listing stays promoted until the end of the paid period and then stops. Part-months
        are not refunded. If we charge you in error, contact us and we will refund it in full.
      </Section>

      <Section title="6. Owner-Initiated Cancellations">
        If a hall owner cancels a confirmed booking, you are entitled to a full refund of the advance payment including the platform fee. Refunds in this case are processed within 7–10 business days. Repeated owner cancellations may result in suspension of the venue from the platform.
      </Section>

      <Section title="7. How to Request a Refund">
        Log in to your Hallnect account and go to My Bookings. Select the booking and use the Cancel Booking option (if within the cancellation window). Alternatively, email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a> with your booking reference number. We will confirm the eligible refund amount based on the venue&apos;s policy and the timing of your request.
      </Section>

      <Section title="7. Refund Processing Time">
        Approved refunds are processed within <strong>7–10 business days</strong> to the original payment method. Bank processing times may add additional delays beyond our control.
      </Section>

      <Section title="8. Disputes">
        If you believe a refund was incorrectly denied, raise a support ticket through your account or email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a> within 7 days of the cancellation decision. We will review and respond within 5 business days. Hallnect&apos;s decision on refund disputes, after review, is final.
      </Section>

      <Section title="9. Changes to This Policy">
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
      <p className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</p>
    </section>
  );
}
