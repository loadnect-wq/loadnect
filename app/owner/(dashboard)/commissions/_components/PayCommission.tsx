"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Copy, IndianRupee, Loader2, QrCode } from "lucide-react";
import { submitCommissionUpiPayment } from "../actions";

interface Props {
  commissionId: string;
  amount:       string;   // pre-formatted, display only
  upiId:        string | null;
  upiQrUrl:     string | null;
  /** When true, an open submission already exists — show "under review" instead. */
  underReview:  boolean;
}

export function PayCommission({ commissionId, amount, upiId, upiQrUrl, underReview }: Props) {
  const [open, setOpen]       = useState(false);
  const [ref, setRef]         = useState("");
  const [shot, setShot]       = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);
  const [copied, setCopied]   = useState(false);
  const [pending, startTransition] = useTransition();

  if (done || underReview) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
        <CheckCircle2 className="h-4 w-4" /> Waiting for admin verification
      </span>
    );
  }

  function copyUpi() {
    if (!upiId) return;
    navigator.clipboard?.writeText(upiId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitCommissionUpiPayment({
        commissionId,
        upiReference: ref,
        screenshotUrl: shot || null,
      });
      if ("error" in result) setError(result.error);
      else setDone(true);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg bg-maroon-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-maroon-800"
      >
        <IndianRupee className="h-3.5 w-3.5" /> Pay Now
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-ivory-50 p-3 text-xs">
      <p className="font-semibold text-charcoal-800">Pay {amount} to Hallnect via UPI</p>

      {/* UPI id / QR from admin settings */}
      <div className="mt-2 space-y-2">
        {upiId ? (
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-white px-2 py-1 font-mono text-charcoal-800">{upiId}</span>
            <button type="button" onClick={copyUpi} className="inline-flex items-center gap-1 text-maroon-700 hover:underline">
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-charcoal-500">
            Hallnect UPI ID is not configured yet. Please contact support before paying.
          </p>
        )}
        {upiQrUrl && (
          <div className="flex items-center gap-2 text-charcoal-500">
            <QrCode className="h-4 w-4" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={upiQrUrl} alt="Hallnect UPI QR" className="h-28 w-28 rounded-lg border border-border object-contain bg-white" />
          </div>
        )}
      </div>

      <p className="mt-3 text-charcoal-600">
        After paying, enter your UPI reference / UTR number. An admin will verify it before the
        commission is marked paid.
      </p>

      <label className="mt-2 block font-medium text-charcoal-700">UPI reference / UTR</label>
      <input
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="e.g. 412345678901"
        className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 text-sm"
        maxLength={40}
      />

      <label className="mt-2 block font-medium text-charcoal-700">Screenshot link (optional)</label>
      <input
        value={shot}
        onChange={(e) => setShot(e.target.value)}
        placeholder="https://…"
        className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 text-sm"
      />

      {error && <p className="mt-2 text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || ref.trim().length < 6}
          className="inline-flex items-center gap-1 rounded-lg bg-maroon-700 px-3 py-1.5 font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Submit for verification
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-lg border border-border bg-white px-3 py-1.5 font-semibold text-charcoal-600 hover:bg-ivory-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
