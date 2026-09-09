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

import { useCallback, useEffect, useSyncExternalStore } from "react";
import Script from "next/script";

/** Public by design — a GA measurement id ships in the page source of every
 *  site that uses one. It is an identifier, not a credential. */
const MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "G-4YVQGMTCR4";

const STORAGE_KEY = "hn_analytics_consent";
type Consent = "granted" | "denied" | "unknown";

/**
 * "This browser belongs to us." Separate from consent, and it wins.
 *
 * WHY NOT GA'S OWN INTERNAL-TRAFFIC FILTER. That matches on IP address, which
 * is fine for a fixed office line and wrong for a home connection: the IP
 * changes, so it quietly stops excluding you — and worse, the stale entry can
 * later exclude a REAL visitor who is assigned that address. Silently dropping
 * genuine traffic is a bigger error than counting your own.
 *
 * This marks the device instead, so it survives an IP change and cannot ever
 * exclude somebody else. The cost is that it is per browser: set it on each
 * device you use, and again if you clear site data. Any GA-side opt-out has
 * that same property.
 */
const INTERNAL_KEY = "hn_internal_traffic";

/** Marking a phone or a second laptop should not require finding a settings
 *  page on a small screen, so any URL with ?exclude-me does it. */
const INTERNAL_PARAM = "exclude-me";

export function isInternalTraffic(): boolean {
  try { return window.localStorage.getItem(INTERNAL_KEY) === "1"; }
  catch { return false; }
}

/**
 * The same answer, but counting ?exclude-me as already-true.
 *
 * FOUND BY TESTING IT ON A BROWSER THAT HAD ALREADY ACCEPTED THE BANNER.
 * Persisting the flag from an effect is one render too late: consent was
 * already "granted", so the tag mounted, gtag.js loaded and sent a page_view
 * before the effect could run — and then re-set the cookies the effect had just
 * cleared. The visit where you ASK to be excluded was the one visit still being
 * counted.
 *
 * Reading the parameter here instead means the very first client render already
 * knows, so the tag never mounts at all. Pure — it only reads location — which
 * is what useSyncExternalStore requires of a snapshot.
 */
function readInternal(): boolean {
  try {
    if (window.localStorage.getItem(INTERNAL_KEY) === "1") return true;
    return new URLSearchParams(window.location.search).has(INTERNAL_PARAM);
  } catch { return false; }
}

export function setInternalTraffic(on: boolean) {
  try {
    if (on) window.localStorage.setItem(INTERNAL_KEY, "1");
    else window.localStorage.removeItem(INTERNAL_KEY);
  } catch { /* storage blocked */ }
  // Turning it on must also remove what earlier acceptance already set.
  if (on) clearAnalyticsCookies();
  emit();
}

/** The toggle in /admin/settings, sharing this module's store so the two agree
 *  without a round trip. Server snapshot is false: the prerendered HTML must
 *  not assert anything about this particular browser. */
export function useInternalTraffic(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, isInternalTraffic, () => false), setInternalTraffic];
}

/**
 * Deletes the cookies Google Analytics set, on withdrawal.
 *
 * FOUND BY TESTING THE DECLINE PATH, not by reading the code. Declining stops
 * the tag loading — verified, zero requests — but it did nothing about cookies
 * an EARLIER acceptance had already caused. So a visitor who said yes and then
 * changed their mind kept _ga and _ga_<id> in their browser, while the banner
 * told them analytics was off and the policy said they could change their mind.
 * Both were then true only about the future.
 *
 * A cookie can only be deleted with the domain and path it was set on, and GA
 * sets them on the registrable domain, so every plausible variant is tried
 * rather than guessed at. Deleting a cookie that does not exist is a no-op.
 */
function clearAnalyticsCookies() {
  try {
    const host = window.location.hostname;
    const parts = host.split(".");
    const domains = [
      undefined,                                   // exactly as set, host-only
      host,
      `.${host}`,
      ...(parts.length > 2
        ? [parts.slice(-2).join("."), `.${parts.slice(-2).join(".")}`]
        : []),
    ];
    for (const raw of document.cookie.split(";")) {
      const name = raw.trim().split("=")[0];
      if (!name.startsWith("_ga")) continue;
      for (const d of domains) {
        document.cookie =
          `${name}=; Max-Age=0; path=/` + (d ? `; domain=${d}` : "");
      }
    }
  } catch { /* storage blocked; nothing to clear */ }
}

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
  const internal = useSyncExternalStore(subscribe, readInternal, () => false);

  // Persist what readInternal already acted on, and tidy the URL. The gate is
  // closed by then — this only makes it outlast the current page.
  useEffect(() => {
    try {
      // An excluded browser should not keep _ga cookies from before it was
      // excluded, however it got that way. The tag is not running to re-set
      // them, so this actually sticks.
      if (isInternalTraffic()) clearAnalyticsCookies();

      const url = new URL(window.location.href);
      if (!url.searchParams.has(INTERNAL_PARAM)) return;
      if (!isInternalTraffic()) setInternalTraffic(true);
      // Strip it again: the param must not survive into a shared link, a
      // bookmark, or the referrer of the next click, or it would silently stop
      // measuring somebody who is not us.
      url.searchParams.delete(INTERNAL_PARAM);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* nothing to do */ }
  }, []);

  const decide = useCallback((value: Exclude<Consent, "unknown">) => {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* nothing to do */ }
    // Withdrawing consent has to remove what consent produced, or "off" is a
    // statement about the future only.
    if (value === "denied") clearAnalyticsCookies();
    emit();
  }, []);

  return (
    <>
      {consent === "granted" && !internal && (
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

      {consent === "unknown" && !internal && (
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
  // Back to undecided means back to not measured, until they answer again.
  clearAnalyticsCookies();
  emit();
}
