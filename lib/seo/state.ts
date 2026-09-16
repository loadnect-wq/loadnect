// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/state.ts — one spelling of a state name.
//
// WHY THIS IS ITS OWN MODULE. canonicalState lived in lib/seo/jsonld.ts, which
// pulls in ./config and through it the canonical-URL machinery. That is fine for
// a page emitting structured data and wrong for a server action saving a form,
// and impossible for a Client Component — the same reason
// lib/seo/service-areas.ts was split out of lib/seo/cities.ts. So the function
// moves here, pure, with no imports at all, and jsonld.ts re-exports it so every
// existing caller is untouched.
//
// WHAT IT DELIBERATELY DOES NOT DO. An unrecognised value passes through
// EXACTLY as written. Normalising is for spellings we know, not for guessing at
// ones we do not: silently rewriting "Tamilnad" is a judgement call, but
// silently rewriting an owner's "Andaman & Nicobar Islands" into something we
// invented is data loss. The map is the whole of the opinion this module holds.
//
// The empty case returns "Tamil Nadu" because every venue on this platform is in
// Tamil Nadu today and a blank state on a listing renders as a missing line in
// the address. That default is a presentation convenience, not a claim — if the
// catalogue ever opens beyond the state, this is the line to revisit.
// ─────────────────────────────────────────────────────────────────────────────

/** Known spellings, keyed by their letters-only lowercase form. */
const KNOWN: Record<string, string> = {
  tamilnadu:     "Tamil Nadu",
  tn:            "Tamil Nadu",
  tamilnad:      "Tamil Nadu",
  puducherry:    "Puducherry",
  pondicherry:   "Puducherry",
  kerala:        "Kerala",
  karnataka:     "Karnataka",
  andhrapradesh: "Andhra Pradesh",
};

export function canonicalState(state: string | null | undefined): string {
  const raw = (state ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Tamil Nadu";
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return KNOWN[key] ?? raw;
}

/**
 * The write-path form: preserves NULL rather than inventing a state for a row
 * that genuinely has none.
 *
 * canonicalState() answers "what should this render as", and its empty case is
 * a presentation default. A column is a different question — writing
 * "Tamil Nadu" into a row where the owner left the field blank would record a
 * fact nobody supplied. So this one only rewrites a spelling it recognises.
 */
export function canonicalStateForStorage(state: string | null | undefined): string | null {
  const raw = (state ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return canonicalState(raw);
}
