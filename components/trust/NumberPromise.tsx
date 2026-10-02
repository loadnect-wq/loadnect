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
//   "Only <hall> gets your number"   RLS: leads_select and bookings_select are
//                                    owns_hall(), so no other venue can read it.
//   "only after you verify it"       enquiry only: leads_select also requires
//                                    phone_verified (0073), so an unverified
//                                    enquiry is invisible even to its own venue.
//                                    NOT said on the booking form, where the
//                                    rule is a display filter, not a policy.
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
        Only {hallName} gets your number{flow === "enquiry" ? ", and only after you verify it" : ""}.
        {" "}We never sell it or share it with other halls.{" "}
        <Link href="/privacy#sharing" className="font-semibold underline underline-offset-2" target="_blank">
          How we use it
        </Link>
      </p>
    </div>
  );
}
