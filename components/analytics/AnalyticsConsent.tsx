"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/analytics/AnalyticsConsent.tsx — the cookie banner, and the Google
// Analytics tag it gates.
//
// NOTHING LOADS UNTIL SOMEBODY SAYS YES. gtag.js is not on the page, no request
// reaches Google, and no cookie is set, until the visitor accepts. That is the
// whole design: /privacy previously said "we do not use analytics, advertising
// or tracking cookies, and we do not run any third-party measurement scripts",
// and the honest way to start measuring is to ask rather than to quietly delete
// the sentence.
//
// ENTIRELY CLIENT-SIDE, AND THAT IS LOAD-BEARING. The public pages are
// prerendered and served from cache to everyone identically (see
// lib/supabase/public.ts). Reading a consent COOKIE on the server would make
// every route dynamic again and undo that work, so the choice lives in
// localStorage — per browser, never sent anywhere, and invisible to the render.
//
// The consequence: the server HTML contains neither the banner nor the tag, and
// both appear after hydration. For a banner that is correct anyway — a cached
// page must not assert what this particular visitor has already decided.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useSyncExternalStore } from "react";
import Script from "next/script";

/** Public by design — a GA measurement id ships in the page source of every
 *  site that uses one. It is an identifier, not a credential. */
const MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "G-4YVQGMTCR4";

const STORAGE_KEY = "hn_analytics_consent";
type Consent = "granted" | "denied" | "unknown";

function read(): Consent {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : "unknown";
  } catch {
    // Private windows and "block site data" both throw here. A visitor whose
    // browser refuses storage has effectively declined, and asking them on
    // every page load would be worse than not measuring them.
    return "denied";
  }
}

// useSyncExternalStore rather than setState-in-an-effect: it takes a separate
// server snapshot, so there is no hydration mismatch and no cascading render.
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab deciding should settle this one too.
  window.addEventListener("storage", fn);
  return () => { listeners.delete(fn); window.removeEventListener("storage", fn); };
}
function emit() { listeners.forEach((fn) => fn()); }

export function AnalyticsConsent() {
  const consent = useSyncExternalStore(subscribe, read, () => "unknown" as Consent);

  const decide = useCallback((value: Exclude<Consent, "unknown">) => {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* nothing to do */ }
    emit();
  }, []);

  return (
    <>
      {consent === "granted" && (
        <>
          <Script
            id="ga-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`}
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              // Consent Mode, stated explicitly. This component only mounts the
              // tag after a yes, so these are already the effective values —
              // but saying so means a future change that loads gtag earlier
              // starts from denied instead of silently collecting.
              gtag('consent', 'default', {
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                analytics_storage: 'granted'
              });
              gtag('config', '${MEASUREMENT_ID}', { anonymize_ip: true });
            `}
          </Script>
        </>
      )}

      {consent === "unknown" && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Cookies"
          className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-white/98 p-4 shadow-elevated backdrop-blur sm:p-5"
        >
          <div className="container-page flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-charcoal-700 sm:text-sm">
              We use cookies that keep you signed in — those are always on. May we also use
              Google Analytics to see which pages people find useful? It is off until you say
              yes, and you can change your mind any time.{" "}
              <a href="/privacy" className="font-semibold text-maroon-700 underline">
                Privacy Policy
              </a>
            </p>
            <div className="flex shrink-0 gap-2">
              {/* Decline first, and styled no less prominently than accept. A
                  banner where refusing is the harder button is not consent. */}
              <button
                type="button"
                onClick={() => decide("denied")}
                className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold text-charcoal-700 hover:bg-ivory-100"
              >
                No thanks
              </button>
              <button
                type="button"
                onClick={() => decide("granted")}
                className="min-h-[44px] rounded-lg bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
              >
                Allow analytics
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Lets /privacy offer a real way to change the answer, which a policy that
 *  promises "you can change your mind" has to actually provide. */
export function resetAnalyticsConsent() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to do */ }
  emit();
}
