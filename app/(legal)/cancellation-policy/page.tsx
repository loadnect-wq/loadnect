import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Cancellation Policy",
  description:
    "How to cancel a Hallnect venue booking, what refund applies based on how far ahead you cancel, and what happens when a venue owner cancels.",
  path: "/cancellation-policy",
});

export default function CancellationPolicyPage() {
  return (
    <article>
      <LegalHeader title="Cancellation Policy" updated="August 2026" />

      <Section title="1. General">
        This Cancellation Policy applies to all bookings made through Hallnect. By confirming a booking and paying the advance, you agree to these cancellation terms. Specific cancellation conditions may vary by venue and are displayed on the booking checkout page before payment. This policy sets the minimum standard that applies to all bookings.
      </Section>

      <Section title="2. Cancellation by Customers">
        You may cancel a confirmed booking through your Hallnect account (My Bookings → Cancel Booking). Cancellations are effective immediately upon submission. The refund you receive depends on when you cancel relative to the event date — see our{" "}
        <a href="/refund-policy" className="text-maroon-600 hover:underline">Refund Policy</a> for the full schedule. You will be shown the expected refund amount before you confirm the cancellation.
      </Section>

      <Section title="3. Advance Payment and Cancellation">
        All bookings require an advance payment to secure the venue, plus a flat ₹200 platform fee collected with it at checkout. The advance is held by Hallnect on behalf of the venue owner. Upon a customer-initiated cancellation, the refundable portion of the <strong>advance</strong> is returned based on the timeline in the Refund Policy; the ₹200 platform fee is non-refundable on customer cancellations.
      </Section>

      <Section title="4. Cancellation by Hall Owners">
        Hall owners may cancel a confirmed booking only in exceptional circumstances such as force majeure, venue damage, or regulatory closure. Owner-cancelled bookings trigger a full refund (including the platform fee) to the customer within 7–10 business days. Owners who repeatedly cancel confirmed bookings may have their listings suspended or permanently removed.
      </Section>

      <Section title="5. Booking Statuses Eligible for Cancellation">
        Cancellations are available for bookings in the following statuses: Payment Received,
        Booking Requested, and Owner Confirmed. A booking still at <strong>Pending Payment</strong>{" "}
        has not been paid for and simply expires on its own — there is nothing to cancel. Once a
        booking is marked Completed, it cannot be cancelled.
      </Section>

      <Section title="6. Venue Verification Before Cancellation">
        Before cancelling, we recommend first contacting the venue owner directly to resolve any concerns about the venue, as cancellations may incur a financial penalty. Customers are advised to visit and verify venue details well before the event date.
      </Section>

      <Section title="7. Cancelling Close to the Event">
        A cancellation made less than 7 days before the event does not qualify for a refund — see
        the schedule in our{" "}
        <a href="/refund-policy" className="text-maroon-600 hover:underline">Refund Policy</a>. If
        you have an emergency, contact our support team at{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>{" "}
        and we will do what we can with the venue.
      </Section>

      <Section title="8. How to Cancel">
        <strong className="font-semibold text-charcoal-800">Customers:</strong> Log in → My Bookings → select booking → Cancel Booking. The refund due is calculated from the schedule in our Refund Policy and confirmed to you by email.
        <br /><br />
        <strong className="font-semibold text-charcoal-800">Owners:</strong> Log in → My Dashboard → Bookings → select booking → Cancel. A reason must be provided.
      </Section>

      <Section title="9. Force Majeure">
        In circumstances beyond the reasonable control of either party — including natural disasters, government-declared emergencies, or pandemic-related restrictions — Hallnect may offer a booking credit, date change, or partial refund at its discretion. These situations are assessed case by case. Contact{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a> immediately if you believe your booking is affected.
      </Section>

      <Section title="10. Dispute Resolution">
        If a cancellation or refund dispute arises, Hallnect will review the case and respond within 7 business days. Our decision in such disputes is final. To raise a dispute, use the Support Tickets feature in your account or email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>.
      </Section>

      <Section title="11. Policy Updates">
        This Cancellation Policy may be updated from time to time. The version applicable to your booking is the one in force at the time the booking was confirmed.
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
