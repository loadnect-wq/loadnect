// ─────────────────────────────────────────────────────────────────────────────
// lib/analytics/redact-url.ts — what Google is allowed to be told the page was.
//
// NO "server-only" HERE, deliberately. This is imported by
// components/analytics/AnalyticsConsent.tsx, which is a Client Component; a
// server-only import would be pulled into the client bundle and fail the build.
// Keep this module pure: no env, no cookies, no imports.
//
// WHY IT EXISTS. GA4's page_view carries the full URL by default, and some of
// this app's URLs identify one person's transaction. Cashfree returns the
// customer to
//
//     /booking/<booking uuid>/status?order_id=<cashfree order id>
//
// as a FRESH DOCUMENT LOAD, so the first page_view of that visit would hand
// Google a booking id and a payment order id together, correlated. The privacy
// policy promises analytics that tell us "which pages people find useful" — a
// path, not a ledger — and this is what makes that literally true.
//
// Two rules, both deliberately blunt:
//
//   1. Every UUID path segment becomes ":id". /booking/<uuid>/status then
//      aggregates into a single row instead of one row per customer, which is
//      also the more useful report.
//   2. The query string is dropped ENTIRELY, rather than filtered against a
//      list of known-bad parameter names. An allowlist is the wrong default:
//      a parameter added next year would leak silently until somebody
//      remembered this file existed.
// ─────────────────────────────────────────────────────────────────────────────

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RedactedPage = { page_location: string; page_path: string };

export function redactUrl(href: string): RedactedPage {
  try {
    const u = new URL(href);
    const path = u.pathname
      .split("/")
      .map((seg) => (UUID_SEGMENT.test(seg) ? ":id" : seg))
      .join("/");
    return { page_location: `${u.origin}${path}`, page_path: path };
  } catch {
    // Never report a URL we could not parse. Reporting nothing is safe;
    // reporting the raw string is the exact thing this function prevents.
    return { page_location: "", page_path: "/" };
  }
}
