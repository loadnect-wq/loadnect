"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Don't count my own visits."
//
// GA ships an internal-traffic filter and this deliberately does not use it.
// That one matches on IP ADDRESS, which is right for a fixed office line and
// wrong here: a home broadband IP changes, so the rule quietly stops excluding
// you — and the stale entry can then exclude a REAL visitor who is handed that
// address later. Under-counting yourself is a cosmetic problem; silently
// dropping a genuine customer's session is a data-integrity one.
//
// So the marker lives on the DEVICE. It survives an IP change, it can never
// affect anyone else, and it is visible and reversible from here.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { EyeOff, Eye, Copy, Check } from "lucide-react";
import { useInternalTraffic } from "@/components/analytics/AnalyticsConsent";

export function InternalTrafficToggle() {
  const [internal, setInternal] = useInternalTraffic();
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");

  // window is not available during the prerender, and this card is inside a
  // statically-rendered page.
  useEffect(() => { setLink(`${window.location.origin}/?exclude-me`); }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the link is on screen to copy by hand */ }
  }, [link]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border py-2">
        <span className="text-sm text-charcoal-700">This browser</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            internal ? "bg-green-100 text-green-800" : "bg-ivory-200 text-charcoal-600"
          }`}
        >
          {internal ? <><EyeOff className="h-3 w-3" /> Not counted</> : <><Eye className="h-3 w-3" /> Counted</>}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setInternal(!internal)}
        className={`mt-3 min-h-[44px] w-full rounded-lg px-4 text-sm font-semibold ${
          internal
            ? "border border-border bg-white text-charcoal-700 hover:bg-ivory-100"
            : "bg-maroon-700 text-white hover:bg-maroon-800"
        }`}
      >
        {internal ? "Start counting this browser again" : "Exclude this browser from analytics"}
      </button>

      <p className="mt-2 text-[11px] text-charcoal-500">
        Turning this on also deletes the GA cookies this browser already has. It is stored per
        browser, so set it on each device — and again if you clear site data. Not IP-based on
        purpose: a home IP changes, and a stale IP rule would eventually exclude a real visitor.
      </p>

      <div className="mt-3 rounded-lg bg-ivory-50 p-2">
        <p className="text-[11px] text-charcoal-600">Open this on your phone or another laptop to exclude it too:</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-charcoal-800">
            {link || "…"}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy link"
            className="shrink-0 rounded border border-border bg-white p-1.5 hover:bg-ivory-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Copy className="h-3.5 w-3.5 text-charcoal-600" />}
          </button>
        </div>
      </div>
    </div>
  );
}
