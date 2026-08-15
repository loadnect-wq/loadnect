import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Disclaimer",
  description: "Hallnect Disclaimer — important limitations and disclosures about using our platform.",
};

export default function DisclaimerPage() {
  return (
    <article>
      <LegalHeader title="Disclaimer" updated="June 2025" />

      <Section title="1. Marketplace Platform">
        Hallnect is an online marketplace that facilitates connections between customers and venue owners. We do not own, operate, manage, or inspect any of the venues listed on this platform. The booking contract is directly between the customer and the venue owner. Hallnect is <strong>not responsible</strong> for the quality, safety, fitness for purpose, or legal compliance of any venue listed on the platform.
      </Section>

      <Section title="2. Accuracy of Venue Information">
        Venue listings — including descriptions, photos, capacity details, amenities, pricing, and availability — are provided by venue owners. Hallnect does not independently verify this information. Photos may not exactly represent the current condition or décor of a venue. Amenity availability (catering, parking, décor, sound systems) should be confirmed directly with the venue owner before booking.
      </Section>

      <Section title="3. Verify Before You Book">
        <strong>Customers are strongly advised to visit the venue and verify all details in person before confirming a booking for an important event.</strong> This is especially important for weddings and large functions. Hallnect cannot be held responsible if a venue does not meet expectations that were not explicitly confirmed in writing with the owner.
      </Section>

      <Section title="4. No Guarantee of Availability">
        Displaying a venue on Hallnect does not guarantee that it is available for your chosen date. A booking is not confirmed until the venue owner accepts and payment is processed. We recommend initiating the booking process well in advance of your event date.
      </Section>

      <Section title="5. Advance Payment Risk">
        Bookings require an advance payment. While Hallnect holds this payment and facilitates refunds per our Refund Policy, the ultimate responsibility for delivering the booked venue rests with the venue owner. Hallnect will assist in resolution but cannot guarantee outcomes in all dispute scenarios.
      </Section>

      <Section title="6. Third-Party Services">
        Hallnect uses third-party services including Cashfree Payments for payment processing and cloud infrastructure providers. We are not responsible for downtime, errors, or losses caused by these third-party providers. Links to external websites are provided for convenience only; Hallnect does not endorse or take responsibility for third-party content.
      </Section>

      <Section title="7. No Professional Advice">
        Information on Hallnect — including venue descriptions, help articles, and platform content — is for general informational purposes only and does not constitute legal, financial, or professional event planning advice. For licensing requirements, safety compliance, or legal matters, consult the relevant authorities and qualified professionals.
      </Section>

      <Section title="8. Limitation of Liability">
        To the maximum extent permitted by applicable Indian law, Hallnect, its directors, employees, and affiliates shall not be liable for: any loss arising from reliance on venue listing information; disputes between customers and venue owners; loss of data or revenue due to platform outages; venue owners failing to honour confirmed bookings; or any indirect, incidental, or consequential damages arising from use of this platform.
      </Section>

      <Section title="9. User Responsibility">
        Users take full responsibility for: verifying venue suitability for their specific event; reading and understanding cancellation and booking terms before paying; communicating directly with venue owners to confirm arrangements not covered in the listing; and ensuring guest numbers do not exceed the venue&apos;s permitted capacity.
      </Section>

      <Section title="10. Platform Changes">
        Hallnect reserves the right to modify, suspend, or discontinue any part of the platform at any time without prior notice. We are not liable to users or venue owners for any modification or interruption of service.
      </Section>

      <Section title="11. Contact">
        If you have concerns about a venue listing or believe information is inaccurate or misleading, report it to us at{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>.
        We will investigate and take appropriate action.
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
