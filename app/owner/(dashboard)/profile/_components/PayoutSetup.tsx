"use client";

import { useState, useTransition } from "react";
import { Banknote, CheckCircle2, Clock, AlertTriangle, Loader2, Pencil } from "lucide-react";
import { savePayoutDetails, refreshPayoutStatus } from "@/app/owner/(dashboard)/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Payout setup — one card, four fields, one button.
//
// Once connected, the customer's advance is split the moment the owner ACCEPTS
// a booking: Hallnect keeps its commission and the rest settles here. Until
// Cashfree has verified the account no money can move, so this card states the
// real status rather than implying it is ready.
//
// WHAT THIS REPLACED. The four details Cashfree needs lived in the Business
// Details form BELOW this card, behind a different submit button, among GST and
// address fields. This card's button did not save anything: when something was
// missing it read "Add pan", and clicking it scrolled down and focused the
// first input in that section — which was always Business Name, never the field
// it named. Setting up a payout account meant filling one form, saving it,
// scrolling back up, and pressing a second button. Now it is one form and one
// button, and the fields are on the card that talks about them.
// ─────────────────────────────────────────────────────────────────────────────

/** id of the Business Details section. Still exported: OwnerProfileForm uses it
 *  as that section's anchor, and "Business name is missing" links to it. */
export const BUSINESS_DETAILS_ID = "business-details";

type Saved = {
  accountNumber: string | null;
  ifsc:          string | null;
  pan:           string | null;
  phone:         string | null;
};

/** Show only the last four digits. There is no reason to render a full account
 *  number back at anyone, and a shoulder-surfed screen is a real risk on a
 *  phone. The value is re-entered in full if it is ever changed. */
function maskAccount(v: string | null): string {
  if (!v) return "—";
  return v.length <= 4 ? v : `${"•".repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}

export function PayoutSetup({
  vendorId,
  kycStatus,
  lastError,
  hasBusinessName,
  saved,
}: {
  vendorId: string | null;
  kycStatus: string | null;
  lastError: string | null;
  hasBusinessName: boolean;
  saved: Saved;
}) {
  const verified    = kycStatus === "VERIFIED";
  const awaitingKyc = !!vendorId && !verified;
  const hasAll = Boolean(saved.accountNumber && saved.ifsc && saved.pan && saved.phone);

  // Open straight away when there is nothing on file — the whole point is that
  // the owner does not have to go looking for the fields.
  const [editing, setEditing] = useState(!hasAll);

  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc,  setIfsc]  = useState(saved.ifsc  ?? "");
  const [pan,   setPan]   = useState(saved.pan   ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await savePayoutDetails({ accountNumber, ifsc, pan, phone });

      if (result.state === "error") { setError(result.error); return; }

      setEditing(false);
      setNotice(
        result.state === "verified"
          ? "Payout account connected. Accepted bookings now pay out to you automatically."
          : result.state === "pending_kyc"
            ? "Saved and submitted. Cashfree is verifying your account — nothing more is needed from you."
            : "Your details are saved. Hallnect is still finishing payout setup with our payment provider; we will switch this on and nothing further is needed from you.",
      );
    });
  }

  function refresh() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await refreshPayoutStatus();
      if ("error" in result) setError(result.error);
      else setNotice("Status checked — reload to see the latest verification status.");
    });
  }

  const tone = verified
    ? "border-green-200 bg-green-50"
    : awaitingKyc
      ? "border-amber-200 bg-amber-50"
      : "border-border bg-white";

  return (
    <div className={`rounded-2xl border-2 p-5 ${tone}`}>
      <div className="flex items-start gap-3">
        {verified ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          : awaitingKyc ? <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          : <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-charcoal-400" />}

        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-sm font-semibold text-charcoal-900">Automatic payouts</h3>

          <p className="mt-0.5 text-xs leading-relaxed text-charcoal-600">
            {verified
              ? "Connected. When you accept a booking, the customer's advance is paid to you automatically — minus Hallnect's commission (2.5% of the hall price), which is deducted at the same time. You never receive a separate commission bill."
              : awaitingKyc
                ? "Your payout account is registered and awaiting verification by Cashfree. Once verified, accepted bookings pay out automatically."
                : "Add the account you want to be paid into. Hallnect's commission (2.5% of the hall price) is deducted from the advance, so you never get a separate bill."}
          </p>

          {!hasBusinessName && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
              Add your business name in{" "}
              <a href={`#${BUSINESS_DETAILS_ID}`} className="font-semibold underline">Business Details</a>{" "}
              below first — Cashfree registers the payout account against your business.
            </p>
          )}

          {/* ── The form ─────────────────────────────────────────────────── */}
          {editing ? (
            <div className="mt-3 space-y-2.5">
              <Field label="Bank account number" hint="Digits only. This is where booking payouts are sent.">
                <input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 20))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={saved.accountNumber ? `Currently ${maskAccount(saved.accountNumber)} — re-enter to change` : "e.g. 50100123456789"}
                  className="min-h-[44px] w-full rounded-lg border border-border px-2.5 text-sm"
                />
              </Field>

              <Field label="IFSC" hint="11 characters, on your cheque book or bank app.">
                <input
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase().slice(0, 11))}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="HDFC0000001"
                  className="min-h-[44px] w-full rounded-lg border border-border px-2.5 text-sm uppercase"
                />
              </Field>

              <Field label="PAN" hint="Required by Cashfree before any payout can be made.">
                <input
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="ABCDE1234F"
                  className="min-h-[44px] w-full rounded-lg border border-border px-2.5 text-sm uppercase"
                />
              </Field>

              <Field label="Business phone" hint="The number Cashfree will verify. 10 digits.">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.slice(0, 20))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  className="min-h-[44px] w-full rounded-lg border border-border px-2.5 text-sm"
                />
              </Field>

              <div className="flex flex-wrap gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || !hasBusinessName}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-maroon-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-maroon-700 disabled:opacity-60"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                  {pending ? "Saving…" : hasAll ? "Save changes" : "Save & connect"}
                </button>
                {hasAll && (
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setError(null); }}
                    disabled={pending}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-charcoal-700 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <p className="text-[10px] text-charcoal-500">
                Saved securely and shared only with Cashfree, who make the payment. Hallnect cannot
                take money out of this account.
              </p>
            </div>
          ) : (
            /* ── The summary ───────────────────────────────────────────── */
            <div className="mt-3 space-y-1.5">
              <Row label="Bank account" value={maskAccount(saved.accountNumber)} />
              <Row label="IFSC"          value={saved.ifsc  ?? "—"} />
              <Row label="PAN"           value={saved.pan   ?? "—"} />
              <Row label="Business phone" value={saved.phone ?? "—"} />

              <div className="flex flex-wrap gap-2 pt-1.5">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold text-charcoal-700"
                >
                  <Pencil className="h-3.5 w-3.5" /> Change details
                </button>
                {awaitingKyc && (
                  <button
                    type="button"
                    onClick={refresh}
                    disabled={pending}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-maroon-600 px-3 text-xs font-semibold text-white hover:bg-maroon-700 disabled:opacity-60"
                  >
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Check verification status
                  </button>
                )}
              </div>
            </div>
          )}

          {/* One error, not two. `error` is this attempt's result; `lastError`
              is the stored outcome of the previous one — when an attempt has
              just failed they are the same string, and rendering both made the
              card look broken. */}
          {(error ?? (verified || notice ? null : lastError)) && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error ?? lastError}
            </p>
          )}
          {notice && !error && (
            <p className="mt-2 rounded-lg bg-green-50 p-2 text-[11px] font-medium text-green-800">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-charcoal-500">{hint}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-charcoal-500">{label}</span>
      <span className="font-medium text-charcoal-800">{value}</span>
    </div>
  );
}
