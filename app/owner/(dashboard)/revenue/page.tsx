import type { Metadata } from "next";
import Link from "next/link";
import { IndianRupee, TrendingUp } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow, fetchOwnerHalls, fetchOwnerRevenue, fetchOwnerCommissions } from "@/lib/owner";
import type { AdvancePayout } from "@/lib/owner";
import { isPayoutsConfigured } from "@/lib/cashfree-payouts";
import { getCommissionPercent } from "@/lib/platform-settings";
import { formatPrice } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/Button";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "Revenue" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const SLOT_LABELS: Record<string, string> = {
  full_day: "Full Day",
  morning:  "Morning",
  evening:  "Evening",
};

export default async function OwnerRevenuePage() {
  await requireRole(["owner_approved"]);

  const ownerRow = await fetchOwnerRow();
  if (!ownerRow) {
    return (
      <div className="min-h-screen bg-ivory-100">
        <AppHeader title="Revenue" notificationsHref="/owner/notifications" />
        <div className="px-4 py-8">
          <EmptyState
            icon={<IndianRupee className="h-8 w-8" />}
            title="No business profile"
            description="Complete your owner profile first."
            action={<Link href="/owner/profile" className={buttonVariants({ variant: "gold", size: "sm" })}>Complete Profile</Link>}
          />
        </div>
      </div>
    );
  }

  const halls         = await fetchOwnerHalls(ownerRow.id);

  // Derived from halls already in hand rather than a second round trip. True
  // when any venue takes payment THROUGH Hallnect, which is the only case where
  // money travels toward the owner and a payout account means anything.
  const takesOnlinePayments = halls.some((h) => h.booking_mode === "DIRECT_BOOKING");
  const hallIds       = halls.map((h) => h.id);
  const [bookings, commissions, commissionPercent] = await Promise.all([
    fetchOwnerRevenue(hallIds),
    fetchOwnerCommissions(hallIds),
    getCommissionPercent(),
  ]);

  // WHAT RATE TO SHOW, now that it is per hall. The single "current rate" this
  // page used to print is only correct for an owner whose halls all agree, so
  // it is derived from their actual halls instead: one rate if they all match,
  // a range if they differ, and the platform default only when none is set.
  const configuredRates = Array.from(
    new Set(halls.map((h) => h.commission_rate).filter((r): r is number => r != null)),
  ).sort((a, b) => a - b);

  const rateLabel =
    configuredRates.length === 0
      ? `${commissionPercent}%`
      : configuredRates.length === 1
        ? `${configuredRates[0]}%`
        : `${configuredRates[0]}%–${configuredRates[configuredRates.length - 1]}%`;

  const ratesVary = configuredRates.length > 1;

  const totalBookingAmount = bookings.reduce((s, b) => s + b.total_amount, 0);
  const totalPayout        = bookings.reduce((s, b) => s + (b.payout_amount ?? 0), 0);
  const completedCount     = bookings.filter((b) => b.status === "completed").length;
  const confirmedCount     = bookings.filter((b) => b.status === "owner_confirmed").length;

  // Commission summary for the owner's own halls only. A row counts once the
  // commission is genuinely Hallnect's — retained from the advance at
  // settlement, or settled at payout. Rows in any other state (waived,
  // refunded, or a historical owner-billed row) are excluded so the figure
  // never overstates what was actually deducted.
  // A payout needs a bank account, an IFSC and a PAN — the same three the
  // payout card asks for.
  const payoutReady = Boolean(
    ownerRow.payout_account_number && ownerRow.payout_ifsc && ownerRow.pan_number,
  );

  // BOTH HALVES, OR THE OWNER IS TOLD SOMETHING UNTRUE. Cashfree Payouts being
  // configured says nothing about whether THIS owner can be paid: every
  // transfer is refused unless their own beneficiary reached VERIFIED. Telling
  // an owner their payouts are automatic when the next transfer will be
  // rejected is worse than telling them nothing.
  const automaticPayoutsLive =
    isPayoutsConfigured() &&
    Boolean(ownerRow.payout_beneficiary_id) &&
    ownerRow.payout_beneficiary_status === "VERIFIED";

  // TWO MODELS, TWO SENTENCES. This total used to merge them and describe the
  // result as "retained from the customer's advance - never billed to you",
  // which is the opposite of the truth for a lead: the owner was invoiced and
  // paid it themselves. lead_id is the discriminator (commissions_one_source).
  const COLLECTED_STATUSES = ["paid", "paid_out", "collected"];
  const collected = commissions.filter((c) => COLLECTED_STATUSES.includes(c.status));
  const commissionRetained = collected
    .filter((c) => c.lead_id == null)
    .reduce((s, c) => s + c.commission_amount, 0);
  const commissionBilled = collected
    .filter((c) => c.lead_id != null)
    .reduce((s, c) => s + c.commission_amount, 0);
  const totalCommissionDeducted = commissionRetained + commissionBilled;

  // Has Hallnect actually paid this owner? Counts only — deliberately no rupee
  // total. A transfer an admin makes by hand records no amount, so summing
  // what IS recorded would quietly under-report the money already sent, and an
  // owner reconciling against their bank statement would come up short. The
  // exact figures sit on the bookings that have them.
  const payouts        = bookings
    .map((b) => b.advance_payout)
    .filter((p): p is AdvancePayout => p !== null);
  const paidCount      = payouts.filter((p) => p.state === "paid").length;
  const awaitingCount  = payouts.filter((p) => p.state === "pending").length;

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Revenue" notificationsHref="/owner/notifications" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Total Bookings"  value={bookings.length.toString()} />
          <SummaryCard label="Completed"       value={completedCount.toString()} />
          <SummaryCard label="Booking Value"   value={formatPrice(totalBookingAmount)} wide />
          <SummaryCard label="Your share"      value={totalPayout > 0 ? formatPrice(totalPayout) : "—"} wide highlight />
        </div>

        {/* "Your share" is the hall price MINUS commission — most of it is
            collected by the venue at the event, not transferred by Hallnect.
            Labelling it "Est. Payout" read as "this is what Hallnect will send
            you", which on a Rs1,00,000 hall overstates the transfer roughly
            fourfold (Rs97,500 shown against a Rs22,500 transfer). */}
        {/* Gated on the mode, because the two halves of this sentence only
            exist for a venue that takes payment through Hallnect. Told to a
            lead-only owner it promised an advance transfer that will never
            arrive. takesOnlinePayments is already computed above for the payout
            prompt; this page knew the answer and did not use it. */}
        <p className="-mt-2 text-[11px] text-charcoal-500">
          {takesOnlinePayments ? (
            <>
              <strong>Your share</strong> is the hall price less Hallnect&apos;s commission, across
              both parts: the advance Hallnect transfers to you after the venue accepts, and the
              balance you collect directly at the event. It is not a single payment from Hallnect.
            </>
          ) : (
            <>
              <strong>Your share</strong> is the hall price less Hallnect&apos;s commission. Your
              venues take enquiries, so you collect the whole amount from the customer yourself -
              Hallnect never holds your money and never transfers you an advance.
            </>
          )}
        </p>

        {/* Platform commission summary — only the owner sees their own halls' commissions */}
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
                {takesOnlinePayments ? "Platform commission deducted" : "Platform commission"}
              </p>
              <p className="mt-0.5 text-xl font-bold text-maroon-700">
                {totalCommissionDeducted > 0 ? formatPrice(totalCommissionDeducted) : "—"}
              </p>
            </div>
            <span className="rounded-full bg-maroon-50 px-2.5 py-1 text-[11px] font-semibold text-maroon-700">
              {ratesVary ? "Your rates" : "Current rate"} {rateLabel}
            </span>
          </div>
          {/* Says which mechanism produced the figure above. Stating "never
              billed to you" over a commission the owner was invoiced for and
              paid by card was simply false. */}
          <p className="mt-2 text-[11px] text-charcoal-500">
            {commissionRetained > 0 && commissionBilled > 0 ? (
              <>
                {formatPrice(commissionRetained)} retained from customers&apos; advances on bookings,
                and {formatPrice(commissionBilled)} invoiced to you and paid on confirmed enquiries.
              </>
            ) : commissionBilled > 0 ? (
              <>
                Invoiced to you on confirmed enquiries and paid - the customer paid you directly, so
                there was no advance to retain it from.
              </>
            ) : takesOnlinePayments ? (
              <>
                Retained from the customer&apos;s advance on successful payment, per booking - never
                billed to you.
              </>
            ) : (
              <>
                Billed to you when you confirm an enquiry, because the customer pays you directly.
                Payable from{" "}
                <Link href="/owner/commissions" className="font-semibold text-maroon-700 underline">
                  Commissions
                </Link>
                .
              </>
            )}{" "}
            You only see your own halls.
          </p>
        </div>

        {/* Payouts — the question this page could not answer before: has
            Hallnect actually sent me my money?

            The HOW is read from the state the payout code obeys, not written
            as a constant, because the two sentences describe genuinely
            different mechanics and the wrong one is a lie either way. It takes
            both halves — the Easy Split flag AND a Cashfree vendor this owner
            can actually be settled to — because a split needs both to run
            (see automaticPayoutsLive above). While either is missing, every
            payout is a transfer a person makes by hand, and saying "we'll
            settle it automatically" would describe something that never
            happens.

            Neither branch names a date. Nothing in the system knows one: a hand
            transfer has no schedule at all, and a gateway settlement lands on
            the gateway's own cycle. A booking reads "paid" only once the
            transfer has actually been recorded against it. */}
        {payouts.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
              Payouts to you
            </p>
            <p className="mt-0.5 text-sm font-semibold text-charcoal-900">
              <span className="text-emerald-700">{paidCount} paid</span>
              {" · "}
              <span className={awaitingCount > 0 ? "text-amber-700" : "text-charcoal-500"}>
                {awaitingCount} awaiting transfer
              </span>
            </p>
            <p className="mt-2 text-[11px] text-charcoal-500">
              Your advance becomes payable once you accept a booking.{" "}
              {automaticPayoutsLive ? (
                <>
                  Hallnect assigns it to your payout account through the payment gateway; when it
                  reaches your bank is the gateway&apos;s settlement cycle, which Hallnect cannot
                  promise here.
                </>
              ) : (
                <>
                  Hallnect pays it by bank or UPI transfer to the payout account on your profile.
                  These transfers are made by hand, not on an automatic schedule, so no transfer
                  date is promised here — a booking below reads as paid only once its transfer has
                  been made.
                </>
              )}{" "}
              The venue balance is not part of this: you collect that yourself at the event.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          {/* rateLabel comes from the owner's OWN halls, not the platform
              default, so this is the rate they will actually be charged. The
              sentence after it is the part that has to follow the mode: "never
              billed separately" is true of a booking and false of an enquiry. */}
          Hallnect&apos;s commission is {rateLabel} of the hall price
          {ratesVary && " — you set it per hall, so it differs between your venues"}
          {takesOnlinePayments ? (
            <>
              , retained from the customer&apos;s advance when you accept. You are never billed
              separately, and the customer&apos;s platform fee is never deducted from you. The venue
              balance is collected by you directly.
            </>
          ) : (
            <>
              . The customer pays you directly, so there is nothing to retain it from: Hallnect
              invoices you once you confirm an enquiry, with a due date, payable by card, UPI or net
              banking from{" "}
              <Link href="/owner/commissions" className="font-semibold underline">Commissions</Link>.
            </>
          )}{" "}
          Each {takesOnlinePayments ? "booking" : "enquiry"} keeps the rate that applied when it was
          made, so changing a hall&apos;s rate never alters one you already have.
          {/* Keyed on what a payout ACTUALLY needs. This used to check
              payout_upi, which no payout uses: Cashfree settles owner payouts
              to a bank account, so an owner with a UPI id and no bank details
              saw no prompt at all and could not be paid. */}
          {/* "so accepted bookings pay out to you" promised the automatic
              mechanism as the reward for filling the form. It is not what
              saving these details switches on — Hallnect needs the account to
              transfer to it either way, which is the honest reason to add it. */}
          {/* Only for an owner who can actually RECEIVE money. A
              lead-generation venue is paid by the customer directly and owes
              Hallnect a commission, so there is nothing to transfer and no
              account to ask for — the prompt used to appear regardless. */}
          {!payoutReady && takesOnlinePayments && (
            <> <Link href="/owner/profile" className="font-semibold underline">Add your payout account</Link> so Hallnect can transfer your advance to you.</>
          )}
        </div>

        {/* Bookings table */}
        {/* "Confirmed and completed bookings will appear here" is a promise
            that cannot come true for a lead-only venue: the book route
            redirects those halls to /enquiry, so no booking row can ever exist.
            Point at the page where their business actually is instead. */}
        {bookings.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-8 w-8" />}
            title={takesOnlinePayments ? "No revenue yet" : "Revenue is collected by you"}
            description={
              takesOnlinePayments
                ? "Confirmed and completed bookings will appear here."
                : "Your venues take enquiries, so customers pay you directly and nothing passes through Hallnect. See Enquiries for the enquiries you have confirmed."
            }
            size="sm"
          />
        ) : (
          <div className="space-y-2.5">
            <h2 className="font-serif text-sm font-semibold text-charcoal-900">Booking History</h2>
            {bookings.map((b) => (
              <div key={b.id} className="rounded-2xl bg-white p-3 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-charcoal-900 truncate">{b.hall_name}</p>
                    <p className="text-xs text-charcoal-500">{fmtDate(b.event_date)} · {SLOT_LABELS[b.slot] ?? b.slot}</p>
                  </div>
                  <div className="shrink-0 text-right space-y-0.5">
                    <p className="text-sm font-bold text-charcoal-900">{formatPrice(b.total_amount)}</p>
                    {b.payout_amount != null && (
                      <p className="text-[11px] font-semibold text-emerald-700">
                        Your share {formatPrice(b.payout_amount)}
                      </p>
                    )}
                    <Badge
                      variant={b.status === "completed" ? "success" : "warning"}
                      size="sm"
                    >
                      {b.status === "completed" ? "Completed" : "Confirmed"}
                    </Badge>
                  </div>
                </div>
                <PayoutLine payout={b.advance_payout} />
              </div>
            ))}
          </div>
        )}

        {confirmedCount > 0 && (
          <p className="text-center text-xs text-charcoal-500">
            {confirmedCount} booking{confirmedCount !== 1 ? "s" : ""} confirmed — mark them complete after the event.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Whether Hallnect has sent the advance for THIS booking.
 *
 * Two things it must never do, because both are how a payout screen turns into
 * a phone call:
 *   • say "paid" on anything but a recorded transfer. lib/owner.ts maps every
 *     not-yet-sent payout state onto "pending" for exactly this reason — while
 *     automatic settlement is off, a booking whose payout has "run" has still
 *     had no money moved.
 *   • print a date that is not in the data. Only an automatic split stamps
 *     one; a bank transfer made by hand does not, so it is simply omitted
 *     rather than replaced with "today" or an estimate.
 */
function PayoutLine({ payout }: { payout: AdvancePayout | null }) {
  if (!payout) {
    return (
      <p className="mt-2 border-t border-ivory-200 pt-2 text-[11px] text-charcoal-400">
        No online advance recorded for this booking.
      </p>
    );
  }

  // "owed or already sent" covers all three refund states this maps from.
  // "Refunded" alone would claim the money had reached the customer when it may
  // still be sitting with Hallnect; "refund in progress" alone would deny that
  // it had, when it may already be gone. Either way the owner's answer is the
  // same, and it is the answer they need: this one is not yours.
  if (payout.state === "refunding") {
    return (
      <p className="mt-2 border-t border-ivory-200 pt-2 text-[11px] text-charcoal-500">
        A refund is owed or already sent on this booking — the advance is the customer&apos;s,
        so no payout is due to you.
      </p>
    );
  }

  if (payout.state === "paid") {
    return (
      <p className="mt-2 border-t border-ivory-200 pt-2 text-[11px] font-semibold text-emerald-700">
        Advance paid to you
        {payout.amount != null && <> · {formatPrice(payout.amount)}</>}
        {payout.paid_at != null && <> · {fmtDate(payout.paid_at)}</>}
      </p>
    );
  }

  return (
    <p className="mt-2 border-t border-ivory-200 pt-2 text-[11px] font-semibold text-amber-700">
      Advance not transferred yet
      {payout.amount != null && <> · {formatPrice(payout.amount)}</>}
    </p>
  );
}

function SummaryCard({
  label, value, highlight = false, wide = false,
}: {
  label: string; value: string; highlight?: boolean; wide?: boolean;
}) {
  return (
    <div className={[
      "rounded-2xl bg-white p-4 shadow-card",
      highlight ? "ring-2 ring-emerald-300" : "",
      wide ? "col-span-2 sm:col-span-1" : "",
    ].join(" ")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
