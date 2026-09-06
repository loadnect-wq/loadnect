import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { legalUpdatedLabel } from "@/lib/content";
import { CONTACT } from "@/lib/constants";

// WHY THIS PAGE EXISTS
//
// Rule 4(4) of the Consumer Protection (E-Commerce) Rules, 2020 requires every
// e-commerce entity operating in India to APPOINT a grievance officer and to
// DISPLAY that officer's name, contact details and designation on the platform.
// Rule 4(5) is the separate clock on that officer: acknowledge within
// forty-eight hours, redress within one month. Neither is satisfied by a
// generic support address — the rule names the officer specifically.
//
// TWO REGIMES, TWO CLOCKS. Hallnect also hosts third-party content — listings,
// photos and reviews supplied by venue owners and customers — which makes it an
// intermediary under the IT Act. Rule 3(2)(a) of the IT (Intermediary
// Guidelines) Rules 2021 sets a SHORTER clock for the same officer:
// acknowledge within 24 hours, dispose within 15 days. Where both apply the
// shorter one governs, so the timelines published below are the intermediary
// ones and they satisfy the e-commerce ones by construction.
//
// Every contact detail below already appears on /contact and in the site's
// JSON-LD, so this page publishes nothing new about anyone; it names the
// accountable person and states the timelines, which is the part that was
// missing.

export const metadata: Metadata = buildMetadata({
  title: "Grievance Redressal",
  description:
    "How to raise a complaint with Hallnect, who handles it, and how long we take. Grievance officer details published under the Consumer Protection (E-Commerce) Rules, 2020.",
  path: "/grievance-redressal",
});

export default function GrievanceRedressalPage() {
  return (
    <article>
      <LegalHeader title="Grievance Redressal" updated={legalUpdatedLabel("/grievance-redressal")} />

      <Section title="1. Raise it with us first">
        Most problems — a venue that does not match its listing, a refund that has not
        arrived, a booking the venue did not honour, a charge you do not recognise — are
        resolved fastest by writing to us directly with your booking reference. Email{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">{CONTACT.email}</a>{" "}
        or call{" "}
        <a href={CONTACT.phoneHref} className="text-maroon-600 hover:underline">{CONTACT.phone}</a>.
        Include your booking reference, the date of the event, and what you would like
        done. If your complaint is about money, say what amount you expected and what you
        received.
      </Section>

      <Section title="2. Grievance Officer">
        In accordance with Rule 4(4) of the Consumer Protection (E-Commerce) Rules, 2020
        and Rule 3(2)(a) of the Information Technology (Intermediary Guidelines and
        Digital Media Ethics Code) Rules, 2021, the following officer is appointed to
        receive and redress consumer complaints:
      </Section>

      <div className="mb-8 rounded-xl border border-border bg-white p-5">
        <dl className="space-y-3 text-sm">
          <Row label="Name" value="Nithin Thangesh I" />
          <Row label="Designation" value="Designated Partner & Grievance Officer" />
          <Row label="Entity" value={CONTACT.legalName} />
          <Row
            label="Email"
            value={
              <a href={`mailto:${CONTACT.email}`} className="text-maroon-600 hover:underline">
                {CONTACT.email}
              </a>
            }
          />
          <Row
            label="Phone"
            value={
              <a href={CONTACT.phoneHref} className="text-maroon-600 hover:underline">
                {CONTACT.phone}
              </a>
            }
          />
          <Row label="Address" value={CONTACT.address} />
        </dl>
      </div>

      <Section title="3. How long we take">
        We will <strong>acknowledge your complaint within 24 hours</strong> of receiving it,
        and <strong>resolve it within 15 days</strong>. Our reply comes from the address
        above and quotes your booking reference, so the email thread is the record of your
        complaint and its status &mdash; keep it and reply on it rather than starting a new
        message. If a complaint depends on a third party &mdash; a refund moving through
        your bank, or a venue owner responding &mdash; we will tell you that, and tell you
        what we are doing about it, rather than letting the clock run quietly.
      </Section>

      <Section title="4. If you are not satisfied">
        If we have not resolved your complaint in that time, or you are unhappy with the
        outcome, you may escalate to the National Consumer Helpline on{" "}
        <strong>1915</strong> or at{" "}
        <a
          href="https://consumerhelpline.gov.in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-maroon-600 hover:underline"
        >
          consumerhelpline.gov.in
        </a>
        , or approach the appropriate Consumer Disputes Redressal Commission. Nothing on
        this page limits any right you have under the Consumer Protection Act, 2019.
      </Section>

      <Section title="5. What we cannot decide for you">
        Hallnect is a marketplace: the booking contract is between you and the venue owner.
        We can investigate, mediate, hold or return the advance we processed, and remove a
        listing that misrepresents itself. We cannot compel a venue owner to perform, and
        we do not adjudicate disputes about anything you agreed with a venue directly and
        outside the platform. Our{" "}
        <a href="/refund-policy" className="text-maroon-600 hover:underline">Refund Policy</a>{" "}
        and{" "}
        <a href="/cancellation-policy" className="text-maroon-600 hover:underline">Cancellation Policy</a>{" "}
        set out what you are entitled to and when.
      </Section>
    </article>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-charcoal-700">{value}</dd>
    </div>
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
