// ─────────────────────────────────────────────────────────────────────────────
// lib/shortlist.ts — "share my shortlist". Safe for the client.
//
// A Tamil wedding hall is chosen by parents, uncles and both families, usually
// in a WhatsApp group. Saved halls live in one phone's localStorage (saving
// needs no account), so until now a shortlist could not leave the phone it was
// made on. A share link carries it: /shortlist/<code> opens the same halls on
// any phone, with a WhatsApp preview naming them.
//
// THE LINK IS THE LIST. The code is the hall ids themselves — sixteen bytes
// each, base64url — so nothing is stored, nothing can be edited by someone
// else, and there is no table for anyone to fill with junk. The cost is a
// longer link (22 characters a hall), which WhatsApp does not mind.
//
// ONE SPELLING PER LIST. decodeShortlist re-encodes what it decoded and
// refuses the code unless it comes out identical, so the same list cannot hide
// behind several URLs (stray padding, uppercase hex, a duplicate id).
// ─────────────────────────────────────────────────────────────────────────────

/** A shortlist, not a catalogue. More than this and it is a search result. */
export const MAX_SHORTLIST = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^[A-Za-z0-9_-]+$/;

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function toBase64Url(bytes: number[]): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): number[] | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The code for these halls, in this order. Invalid ids and repeats are
 * dropped, and the list is cut at MAX_SHORTLIST. Null when nothing is left.
 */
export function encodeShortlist(ids: readonly string[]): string | null {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.toLowerCase() : "";
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push(id);
    if (clean.length === MAX_SHORTLIST) break;
  }
  if (clean.length === 0) return null;
  return toBase64Url(clean.flatMap((id) => hexToBytes(id.replace(/-/g, ""))));
}

/** The hall ids in a code, in order — or null for anything that is not exactly one canonical shortlist code. */
export function decodeShortlist(code: string): string[] | null {
  if (typeof code !== "string" || code.length === 0 || code.length > 300 || !CODE_RE.test(code)) return null;
  const bytes = fromBase64Url(code);
  if (!bytes || bytes.length === 0 || bytes.length % 16 !== 0) return null;
  const count = bytes.length / 16;
  if (count > MAX_SHORTLIST) return null;

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = bytes.slice(i * 16, i * 16 + 16).map((b) => b.toString(16).padStart(2, "0")).join("");
    ids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
  return encodeShortlist(ids) === code ? ids : null;
}

export function shortlistPath(code: string): string {
  return `/shortlist/${code}`;
}

type Named = { name: string; city: string };

/** "NS Khalyaana Mahal, Sri Mahal and 2 more" — for previews, where space is short. */
export function hallNamesSummary(halls: readonly Named[], show = 2): string {
  const names = halls.map((h) => h.name);
  if (names.length <= show + 1) {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, show).join(", ")} and ${names.length - show} more`;
}

/** "Madurai", "Madurai and Coimbatore", or "3 cities". */
export function citiesSummary(halls: readonly Named[]): string {
  const cities = [...new Set(halls.map((h) => h.city).filter(Boolean))];
  if (cities.length <= 2) return cities.join(" and ");
  return `${cities.length} cities`;
}

/** The page title and WhatsApp preview headline. The site's title template adds "| Hallnect". */
export function shortlistTitle(count: number): string {
  return count === 1 ? "1 hall shortlisted" : `${count} halls shortlisted`;
}

/**
 * The message that goes into the family group, in the sender's own voice —
 * it is sent from their WhatsApp, not by Hallnect.
 */
export function shareMessage(url: string, count: number): string {
  return `${shortlistShareText(count)}\n${url}`;
}

/** The same message without the link, for components that append it themselves. */
export function shortlistShareText(count: number): string {
  return count === 1
    ? "Here's the hall I've shortlisted on Hallnect. What do you think?"
    : `Here are the ${count} halls I've shortlisted on Hallnect. Which one do you like?`;
}

/** A wa.me link with no number: WhatsApp asks which chat to send it to. */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
