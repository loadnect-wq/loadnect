"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Phone } from "lucide-react";
import { updateAdminWhatsAppNumber } from "@/app/admin/actions";

// ─────────────────────────────────────────────────────────────────────────────
// Which number receives platform admin alerts.
//
// Shown here rather than on the settings page because this is where an admin
// asks "who is being told about this?". The stored value lives on
// platform_settings, so changing it takes effect immediately — no redeploy.
//
// The current number is passed in MASKED. An admin can set a new number but
// cannot read the existing one back out of the page source, which keeps a
// personal phone number out of rendered HTML.
// ─────────────────────────────────────────────────────────────────────────────

export function AdminAlertNumberForm({
  currentMasked,
  source,
}: {
  currentMasked: string;
  /** Where the number in effect actually comes from right now. */
  source: "settings" | "env" | "constant" | "none";
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const sourceLabel =
    source === "settings"   ? "set here"
    : source === "env"      ? "from ADMIN_WHATSAPP_NUMBER"
    : source === "constant" ? "falling back to the public contact number"
    : "not configured";

  function save() {
    setError(null); setSaved(false);
    start(async () => {
      const r = await updateAdminWhatsAppNumber(value);
      if ("error" in r) setError(r.error);
      else { setSaved(true); setValue(""); }
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Phone className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
        <p className="text-xs font-semibold text-charcoal-800">Admin alert number</p>
        <span className="font-mono text-[11px] text-charcoal-500">{currentMasked}</span>
        <span className="text-[10px] text-charcoal-400">({sourceLabel})</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="tel"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="+91 98765 43210 — leave blank and save to clear"
          className="min-h-[40px] flex-1 rounded-lg border border-border bg-white px-3 text-sm text-charcoal-900 outline-none focus:border-maroon-500 focus:ring-1 focus:ring-maroon-500 sm:max-w-xs"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 text-sm font-semibold text-white hover:bg-charcoal-800 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
      {saved && !error && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved — reload to see the number in effect.
        </p>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-charcoal-400">
        Operational alerts (new bookings, payments, hall submissions, failures) go to this
        number on WhatsApp. It must be a number that has WhatsApp installed.
      </p>
    </div>
  );
}
