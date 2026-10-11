// ─────────────────────────────────────────────────────────────────────────────
// Guide: how to choose a birthday or party hall (/guides/birthday-party-hall).
// Searched as "birthday party halls in madurai", "party hall in madurai with
// price", "birthday party halls in coimbatore with price". English only: Google
// showed no Tamil searches for it (the content plan's rule), so it has no Tamil
// twin until Search Console shows Tamil queries.
//
// WHAT HALLNECT CAN SAY, AND NO MORE:
//   * a hall's page shows morning and evening prices where the hall sets them
//     (HallDetailView's slot rows);
//   * /halls filters by guests and by amenity;
//   * a quote request carries the date, the occasion, the guest count and a
//     free-text note — there is NO slot field, so the page says to put the
//     time in the note rather than promising a slot picker that does not exist.
// Everything else is a question to ask the hall, not a claim about halls.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { CheckCircle2, Search } from "lucide-react";
import { guideBySlug, guidePath } from "@/lib/guides";
import { GuideSection, GuideShell, type GuideFaq, type RelatedLink } from "./GuideShell";

const GUIDE = guideBySlug("birthday-party-hall");

export const PARTY_LEAD =
  "Start from your guest count and the time of day. A birthday or a party rarely needs the whole day, so ask about a morning or an evening slot, and check the seating, air conditioning, food, decoration rules, music timings and parking before you pay anything.";

/** What to check, beyond the size and the slot. */
export const PARTY_CHECKS: readonly { title: string; detail: string }[] = [
  { title: "Air conditioning", detail: "Whether the hall is air-conditioned, and how many hours of it the price includes." },
  { title: "Power backup", detail: "Whether a generator keeps the lights, fans and music running if the power goes." },
  { title: "Food", detail: "Whether you may bring your own caterer, cake and snacks, or must use the hall's, and any fee for outside food." },
  { title: "Decoration rules", detail: "What is allowed on the walls and the stage, balloons and confetti included, and who cleans up after." },
  { title: "Music and timings", detail: "Until what time music may play, and when you must leave the hall." },
  { title: "Children", detail: "An open space for them, and how safe the stairs and any balconies are." },
  { title: "Elders", detail: "A lift or a ramp, comfortable seating, and washrooms close by." },
  { title: "Parking", detail: "How many cars and two-wheelers it takes, and whether it is on the premises." },
];

export const PARTY_FAQS: GuideFaq[] = [
  {
    q: "Can I book a hall for just a few hours?",
    a: "Many halls rent a morning or an evening slot instead of the full day. Say the time you need when you ask for a quote, and get the exact start and end times in writing.",
  },
  {
    q: "Can we bring our own cake, food and decorations?",
    a: "It depends on the hall. Some insist on their own caterer or decorator, and some charge a fee for outside ones. Ask before you book, and get the answer in writing.",
  },
  {
    q: "How much does a party hall cost?",
    a: "It depends on the city, the hall, the slot and what is included. Ask halls for a quote for your date and time; the wedding hall cost guide explains what a hall's bill can add to the rent.",
  },
];

function related(): RelatedLink[] {
  const cost = guideBySlug("wedding-hall-cost-tamil-nadu");
  const advance = guideBySlug("before-you-pay-a-hall-advance");
  return [
    { href: guidePath(cost.slug, "en"), label: cost.en.heading, note: cost.en.card },
    { href: guidePath(advance.slug, "en"), label: advance.en.heading, note: advance.en.card },
  ];
}

export function PartyHallGuide() {
  return (
    <GuideShell guide={GUIDE} lang="en" lead={PARTY_LEAD} faqs={PARTY_FAQS} related={related()}>
      <GuideSection id="size" title="How big a hall?">
        <p>
          Count the guests you expect, then look for a hall that seats a few more than that. Check the dining area
          too: how many it serves at one sitting decides how long the meal takes. On Hallnect you can filter halls by
          the number of guests.
        </p>
      </GuideSection>

      <GuideSection id="slot" title="Morning, evening or the full day">
        <p>
          Many halls rent a morning or an evening slot for less than the full day, which suits a party of a few hours.
          A hall&apos;s page on Hallnect shows its morning and evening prices where the hall sets them. When you ask
          for a quote, say the time you need in your message.
        </p>
      </GuideSection>

      <GuideSection id="checks" title="What to check before you book">
        <ul className="grid gap-2.5">
          {PARTY_CHECKS.map((c) => (
            <li key={c.title} className="flex gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-charcoal-900">{c.title}</span>
                <span className="mt-0.5 block text-sm text-charcoal-700">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p>On Hallnect you can also filter halls by amenity, air conditioning and parking among them.</p>
      </GuideSection>

      <GuideSection id="find" title="Find a party hall">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href="/venues/birthday-party" className="inline-flex min-h-[44px] items-center rounded-full bg-white px-4 text-sm font-semibold text-maroon-700 shadow-card ring-1 ring-border hover:ring-maroon-300">
              Birthday party halls
            </Link>
          </li>
          <li>
            <Link href="/venues/party" className="inline-flex min-h-[44px] items-center rounded-full bg-white px-4 text-sm font-semibold text-maroon-700 shadow-card ring-1 ring-border hover:ring-maroon-300">
              Party halls
            </Link>
          </li>
        </ul>
        <Link
          href="/halls"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          <Search className="h-4 w-4" aria-hidden /> Search all halls
        </Link>
      </GuideSection>
    </GuideShell>
  );
}
