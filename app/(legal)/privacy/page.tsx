import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Hallnect collects, uses and protects your personal data — what we store for bookings, who we share it with, and how to request deletion.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <article>
      <LegalHeader title="Privacy Policy" updated="June 2025" />

      <Section title="1. Who We Are">
        Hallnect is operated by <strong>HALLNECT LLP</strong>, an Indian company. We act as the data controller for personal information collected through this platform. For privacy concerns, contact us at{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>.
      </Section>

      <Section title="2. Information We Collect">
        We collect: account information you provide (name, email, phone number); booking information (event date, hall selected, guests, payment transaction references); venue owner information (business name, hall details, pricing, photos); and usage data (pages visited, search queries, device type, IP address for security).
      </Section>

      <Section title="3. How We Use Your Information">
        We use your information to process bookings and facilitate communication between customers and venue owners; to verify your identity and maintain account security; to process payments and issue refunds through Cashfree Payments; to send booking confirmations, reminders, and support responses; to display your reviews on venue pages; and to comply with legal obligations under Indian law. We do not sell your personal data to third parties.
      </Section>

      <Section title="4. Payment Data">
        Payment processing is handled by Cashfree Payments. Hallnect does not store your card number, CVV, or banking credentials. We only retain a transaction reference number for booking records.
      </Section>

      <Section title="5. Data Sharing">
        We share your information only with: (a) venue owners to fulfil your confirmed booking — your name and contact details are shared so the owner can prepare for your event; (b) Cashfree Payments for transaction processing; (c) cloud infrastructure and email delivery service providers under strict confidentiality agreements; and (d) law enforcement when required by a valid legal order. Venue owners may not use customer contact details for any purpose other than fulfilling the specific booking.
      </Section>

      <Section title="6. Cookies">
        We use essential cookies for authentication and session management, and analytics cookies to understand how users interact with the platform. You can manage cookie preferences through your browser settings, though disabling essential cookies may affect platform functionality.
      </Section>

      <Section title="7. Data Retention">
        We retain your personal data for as long as your account is active. After account deletion, account details are removed within 30 days. Booking and transaction records are retained for 7 years to comply with Indian financial recordkeeping laws.
      </Section>

      <Section title="8. Your Rights">
        You have the right to access, correct, or delete your personal data; to withdraw consent for optional communications; and to lodge a complaint with the relevant data protection authority. To exercise these rights, email{" "}
        <a href="mailto:hallnect@gmail.com" className="text-maroon-600 hover:underline">hallnect@gmail.com</a>. We will respond within 30 days.
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
      <p className="mt-2 text-sm leading-relaxed text-charcoal-600">{children}</p>
    </section>
  );
}
