"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { updatePlatformPaymentSettings } from "@/app/admin/actions";

// The UPI id / QR, commission due-days and the two owner-billing toggles were
// removed with the owner-billed commission model. Commission is now retained
// from the customer's advance and owners are never invoiced, so there is no due
// date to configure, no Hallnect UPI address for owners to pay into, and no
// overdue settlement adjustment to enable.

type Initial = {
  defaultAdvancePercentage: number;
  enableOnlineCustomerPayment: boolean;
};

export function PaymentSettingsForm({ initial }: { initial: Initial }) {
  const [advance, setAdvance]     = useState(String(initial.defaultAdvancePercentage));
  const [onlinePay, setOnlinePay] = useState(initial.enableOnlineCustomerPayment);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null); setSaved(false);
    startTransition(async () => {
      const r = await updatePlatformPaymentSettings({
        defaultAdvancePercentage: parseFloat(advance),
        enableOnlineCustomerPayment: onlinePay,
      });
      if ("error" in r) setError(r.error);
      else setSaved(true);
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <Field label="Default advance (%)">
        <input type="number" min={0} max={100} value={advance} onChange={(e) => setAdvance(e.target.value)}
          className="w-full rounded-lg border border-border px-2.5 py-1.5" />
      </Field>

      <Toggle label="Enable online customer payment (Cashfree)" checked={onlinePay} onChange={setOnlinePay} />

      <p className="rounded-lg bg-ivory-100 p-2.5 text-[11px] leading-relaxed text-charcoal-600">
        Commission is fixed at 2.5% of the hall price and is retained from the customer&apos;s
        advance automatically. Owners are never billed, so there is nothing to configure here.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && (
        <p className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
          <CheckCircle2 className="h-4 w-4" /> Saved
        </p>
      )}

      <button type="button" onClick={save} disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-maroon-700 px-4 py-2 text-xs font-semibold text-white hover:bg-maroon-800 disabled:opacity-60">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save payment settings
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-white p-2.5 text-xs text-charcoal-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-charcoal-300 text-maroon-600 focus:ring-maroon-500" />
      <span>{label}</span>
    </label>
  );
}
