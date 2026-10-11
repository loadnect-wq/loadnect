// ─────────────────────────────────────────────────────────────────────────────
// Guide for hall owners: the booking receipt template
// (/guides/marriage-hall-booking-receipt). Searched as "marriage hall booking
// receipt format", "marriage hall booking form format pdf". English only:
// Google showed no Tamil searches for it.
//
// Not under /owner…: robots.txt disallows "/owner", and a Disallow is a prefix
// match, so "/owners/…" would be invisible to search. Every guide lives under
// /guides.
//
// The template (ReceiptTemplate) is the page's tool; this frame says what a
// receipt must show and points the owner at the one thing Hallnect does with a
// booking taken off-platform — the calendar's offline booking, which stops the
// same date being sold online (lib/offline-bookings.ts).
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Store } from "lucide-react";
import { guideBySlug, guidePath } from "@/lib/guides";
import { GuideSection, GuideShell, type GuideFaq, type RelatedLink } from "./GuideShell";
import { ReceiptTemplate } from "./ReceiptTemplate";

const GUIDE = guideBySlug("marriage-hall-booking-receipt");

export const RECEIPT_LEAD =
  "A booking receipt should name the hall and the family, give the function's date and slot, the agreed price, the advance received, the balance and the date it is due, and the cancellation terms. Fill in the template below, then print it or save it as a PDF from your browser's print screen. What you type stays in your browser: Hallnect does not receive it.";

export const RECEIPT_MUST_SHOW: readonly string[] = [
  "The hall's name, address and phone, so the family knows who to call.",
  "A receipt number and date, so you can find it in your books.",
  "The family's name and phone number.",
  "The function, its date and the slot (full day, morning or evening), and roughly how many guests.",
  "The agreed price for the booking, the advance received and how it was paid.",
  "The balance, and the date by which it is due.",
  "The cancellation terms: how much of the advance comes back, and until when.",
  "Signatures from both sides.",
];

export const RECEIPT_FAQS: GuideFaq[] = [
  {
    q: "What should a marriage hall booking receipt include?",
    a: "The hall's and the family's names and phone numbers, the function's date and slot, the agreed price, the advance received and how it was paid, the balance and when it is due, the cancellation terms, and both signatures.",
  },
  {
    q: "Is this receipt a GST invoice?",
    a: "No. It records a booking and the advance received. If your hall is registered for GST, ask your accountant what your tax invoices must show.",
  },
  {
    q: "Is what I type saved or sent anywhere?",
    a: "No. The template works only in your browser: nothing you type is sent to Hallnect, and it is gone when you close the page. Print it or save it as a PDF to keep a copy.",
  },
];

function related(): RelatedLink[] {
  const advance = guideBySlug("before-you-pay-a-hall-advance");
  return [
    { href: guidePath(advance.slug, "en"), label: advance.en.heading, note: "The questions families are told to ask you before they pay. Have the answers ready." },
    { href: "/owner/register", label: "List your hall on Hallnect", note: "Listing is free. Families ask you for quotes, and you see their number only once they accept." },
  ];
}

export function ReceiptGuide() {
  return (
    <GuideShell guide={GUIDE} lang="en" lead={RECEIPT_LEAD} faqs={RECEIPT_FAQS} related={related()}>
      <GuideSection id="template" title="Fill in the receipt">
        <ReceiptTemplate />
      </GuideSection>

      <GuideSection id="must-show" title="What every booking receipt should show">
        <ul className="list-disc space-y-1.5 pl-5">
          {RECEIPT_MUST_SHOW.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </GuideSection>

      <GuideSection id="on-hallnect" title="Record the booking on Hallnect too">
        <p>
          If your hall is on Hallnect, add a booking you took by phone to your hall&apos;s calendar as an offline
          booking. The date then shows as taken, so it cannot also be booked online. Listing a hall on Hallnect is
          free.
        </p>
        <Link
          href="/owner/register"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          <Store className="h-4 w-4" aria-hidden /> List your hall
        </Link>
      </GuideSection>
    </GuideShell>
  );
}
