// Static content used across public pages.
// Keep data here so components stay logic-only.
//
// TESTIMONIALS, FAQ_ITEMS, WHY_CHOOSE and OWNER_BENEFITS were removed. None was
// imported by anything, and each asserted something untrue: three invented
// couples with invented 2023/2024 weddings at halls that do not exist, a "24/7
// wedding concierge team", "thousands of couples search Hallnect every day",
// "instant confirmation ... locked in with a digital guarantee" (a booking is
// not confirmed until the venue accepts it), and an owner-cancellation promise
// to "find an alternative venue at no extra cost". Dead code is harmless right
// up to the moment somebody renders it, and fabricated reviews on a live
// marketplace are not a small mistake. The same reasoning retired PREMIUM_TIERS
// below.
//
// PREMIUM_TIERS was removed. It was a SECOND, hardcoded plan catalogue that
// disagreed with the real one in premium_plans: it named the Rs4,999 plan
// "Pro" (its actual name is Premium) and advertised an "Elite" plan at Rs9,999
// that does not exist - the Rs9,999 plan is Pro. It also sold an analytics
// dashboard and priority support, neither of which is built. Only the owner
// dashboard rendered it, and that now reads fetchPremiumPlans() + PLAN_FEATURES
// like every other plan surface, so there is one catalogue again.

// ─── Legal page dates ────────────────────────────────────────────────────────
//
// Each legal page prints "Last updated: <month year>" and each has an entry in
// the sitemap carrying a lastModified. Those are two statements about the same
// fact, and when they were written separately they disagreed: the pages said
// August while sitemap.ts stamped `new Date()`, so every crawl claimed all six
// policies had been rewritten that morning. A sitemap date a crawler can see is
// contradicted on the page itself is worse than no date at all.
//
// One entry per page here, read by both. Move a date only when the page's WORDS
// change — a refactor that leaves the rendered text identical is not an update,
// and telling a customer their binding terms changed when they did not is the
// same lie in the other direction.
export const LEGAL_LAST_UPDATED = {
  "/terms":                "2026-09-06",
  "/privacy":              "2026-09-09",
  "/refund-policy":        "2026-09-06",
  "/cancellation-policy":  "2026-09-06",
  "/grievance-redressal":  "2026-09-04",
  "/disclaimer":           "2026-08-28",
} as const;

export type LegalPath = keyof typeof LEGAL_LAST_UPDATED;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "2026-09-06" → "September 2026", for the header line on the page.
 *
 * Read off the string rather than through Date on purpose: `new Date("2026-09-01")`
 * is UTC midnight, which is the previous month wherever the renderer sits west of
 * Greenwich — so a policy updated on the 1st would print the wrong month.
 */
export function legalUpdatedLabel(path: LegalPath): string {
  const [year, month] = LEGAL_LAST_UPDATED[path].split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** The same date as a Date, for sitemap lastModified. */
export function legalLastModified(path: LegalPath): Date {
  return new Date(`${LEGAL_LAST_UPDATED[path]}T00:00:00Z`);
}

// Tamil Nadu only. No fabricated venue counts — tiles link to the real search.
export const POPULAR_CITIES = [
  { name: "Madurai",          state: "Tamil Nadu", gradient: "linear-gradient(135deg,#6B1525 0%,#9B2038 100%)" },
  { name: "Chennai",          state: "Tamil Nadu", gradient: "linear-gradient(135deg,#831843 0%,#BE185D 100%)" },
  { name: "Coimbatore",       state: "Tamil Nadu", gradient: "linear-gradient(135deg,#064E3B 0%,#065F46 100%)" },
  { name: "Tiruchirappalli",  state: "Tamil Nadu", gradient: "linear-gradient(135deg,#78350F 0%,#B45309 100%)" },
  { name: "Salem",            state: "Tamil Nadu", gradient: "linear-gradient(135deg,#4C1D95 0%,#6D28D9 100%)" },
  { name: "Tirunelveli",      state: "Tamil Nadu", gradient: "linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 100%)" },
  { name: "Thanjavur",        state: "Tamil Nadu", gradient: "linear-gradient(135deg,#134E4A 0%,#0F766E 100%)" },
  { name: "Erode",            state: "Tamil Nadu", gradient: "linear-gradient(135deg,#1C1917 0%,#44403C 100%)" },
] as const;
