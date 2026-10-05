// ─────────────────────────────────────────────────────────────────────────────
// "No spam calls." — the promise next to every phone box on an enquiry or a
// booking form.
//
// WHY. One enquiry on Justdial or Sulekha brings calls from many businesses;
// that is the complaint families repeat most about the directories Hallnect
// competes with. Hallnect already works the opposite way. This says so, at the
// moment the customer decides whether to type their number.
//
// EVERY CLAUSE IS ENFORCED, NOT ASPIRATIONAL — keep it that way:
//   ENQUIRY (quotes before the number, 0112):
//   "<hall> sees your request,       no session can read leads.contact_phone
//    not your number"                (0112 column grant); lib/leads.ts forVenue
//                                    blanks it in the venue's view.
//   "It gets your number only if     phoneVisibleToVenue: accepted or
//    you accept its quote"           confirmed only; a lead cannot be booked
//                                    without acceptance (0112 constraint).
//   BOOKING (direct booking, switched off since 0112 but kept):
//   "Only <hall> gets your number"   RLS: bookings_select is owns_hall().
//   BOTH:
//   "We never sell it"               Privacy Policy section 3.
//   "or share it with other halls"   Privacy Policy section 5(a), which this
//                                    links to (#sharing).
// If any of these stops being true, change this copy in the same commit.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function NumberPromise({
  hallName,
  flow,
  className = "",
}: {
  hallName: string;
  /** "enquiry" adds "only after you verify it", which only enquiries enforce. */
  flow: "enquiry" | "booking";
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 rounded-xl bg-green-50 px-3 py-2.5 text-xs leading-relaxed text-green-900 ${className}`}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden />
      <p>
        <strong className="font-semibold">No spam calls.</strong>{" "}
        {flow === "enquiry"
          ? `${hallName} sees your request, not your number. It gets your number only if you accept its quote.`
          : `Only ${hallName} gets your number.`}
        {" "}We never sell it or share it with other halls.{" "}
        <Link href="/privacy#sharing" className="font-semibold underline underline-offset-2" target="_blank">
          How we use it
        </Link>
      </p>
    </div>
  );
}
