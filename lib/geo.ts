// ─────────────────────────────────────────────────────────────────────────────
// Turning "the link from my phone" into a map pin.
//
// halls.latitude / halls.longitude have existed since 0002 and the READ path
// has been wired the whole time — lib/halls.ts numifies them, the venue page
// hands them to venueJsonLd, and lib/seo/jsonld.ts emits a GeoCoordinates node
// when both are present. Nothing could ever WRITE them, so that node has never
// once been emitted. Migration 0089 granted the columns; this is the half that
// makes the grant mean something.
//
// AN OWNER WILL NEVER TYPE COORDINATES. They will open Google Maps, press
// Share, and paste whatever comes out. So the input is "a Google Maps link, or
// coordinates", and the parsing is the feature.
// ─────────────────────────────────────────────────────────────────────────────

export type Coordinates = { latitude: number; longitude: number };

export type MapInputParse =
  | { kind: "empty" }
  | { kind: "coords"; value: Coordinates }
  /** A share link that hides its coordinates behind a redirect. Only a server
   *  can follow it — see resolveMapInput. */
  | { kind: "short-link"; url: string }
  | { kind: "error"; message: string };

/**
 * Tamil Nadu, with a margin.
 *
 * Hallnect lists Tamil Nadu venues, and the failure this catches is not an
 * owner in the wrong state — it is a paste of the wrong thing entirely. A link
 * copied from an earlier search, or a browser's default map centre, lands
 * thousands of kilometres away; without a bounds check that silently becomes a
 * GeoCoordinates node telling Google the venue is somewhere it is not, which is
 * worse than emitting nothing at all.
 *
 * Deliberately loose: real coastal and border venues must not be refused. Widen
 * here (and reword the message below) the day listings open beyond the state.
 */
export const VENUE_BOUNDS = {
  minLat:  7.9,
  maxLat: 13.8,
  minLng: 76.0,
  maxLng: 80.6,
} as const;

/** Hosts whose links are a redirect to a real maps URL. Nothing else is ever
 *  fetched — see resolveMapInput for why that matters. */
const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

const NUM = "[-+]?\\d{1,3}(?:\\.\\d+)?";

// Ordered by how much they can be trusted.
//
//   !3d / !4d is the PLACE's own coordinate, carried in the data= blob.
//   q= / query= is what the Maps URL API documents for an explicit point.
//   @lat,lng is only the VIEWPORT CENTRE — near the pin, but not the pin, and
//   it moves if the user panned before sharing. Tried last of the URL forms.
const PATTERNS: RegExp[] = [
  new RegExp("!3d(" + NUM + ")!4d(" + NUM + ")"),
  new RegExp("[?&](?:q|query|destination)=(" + NUM + ")\\s*,\\s*(" + NUM + ")"),
  new RegExp("[?&]ll=(" + NUM + ")\\s*,\\s*(" + NUM + ")"),
  new RegExp("@(" + NUM + "),(" + NUM + ")"),
  new RegExp("^\\s*(" + NUM + ")\\s*,\\s*(" + NUM + ")\\s*$"),
];

function round6(n: number): number {
  // halls.latitude is numeric(9,6). Storing more precision than the column
  // holds means the value read back differs from the value saved, and any
  // "unsaved changes" check would then always believe the form was dirty.
  return Math.round(n * 1e6) / 1e6;
}

/** Bounds-checks a pair, returning the reason it was refused, or null. */
export function checkCoordinates(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "That does not look like a map location.";
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return "Those coordinates are not a real place on Earth.";
  }
  const { minLat, maxLat, minLng, maxLng } = VENUE_BOUNDS;
  if (latitude < minLat || latitude > maxLat || longitude < minLng || longitude > maxLng) {
    return (
      "That pin is outside Tamil Nadu. Open Google Maps, search for your venue by name, " +
      "then press Share and copy that link — a link left over from an earlier search points somewhere else."
    );
  }
  return null;
}

/**
 * Reads coordinates out of whatever the owner pasted.
 *
 * Pure and synchronous, so the form can reach the same verdict as the server
 * before anything is submitted. The one case it cannot settle alone is a share
 * link, which it reports rather than guesses at.
 */
export function parseMapInput(raw: string): MapInputParse {
  const input = (raw ?? "").trim();
  if (!input) return { kind: "empty" };
  if (input.length > 2048) {
    return { kind: "error", message: "That link is too long to be a map link." };
  }

  // A share link has to be recognised BEFORE the patterns run: its shortened
  // path can contain digits a loose pattern would happily read as a latitude,
  // and a plausible WRONG pin is the outcome most worth avoiding here.
  if (/^https?:\/\//i.test(input)) {
    let host: string;
    try {
      host = new URL(input).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return { kind: "error", message: "That is not a valid link." };
    }
    if (SHORT_LINK_HOSTS.has(host)) return { kind: "short-link", url: input };
  }

  for (const re of PATTERNS) {
    const m = input.match(re);
    if (!m) continue;
    const latitude = round6(Number.parseFloat(m[1]));
    const longitude = round6(Number.parseFloat(m[2]));
    const problem = checkCoordinates(latitude, longitude);
    if (problem) return { kind: "error", message: problem };
    return { kind: "coords", value: { latitude, longitude } };
  }

  return {
    kind: "error",
    message:
      "No location found in that. Open your venue in Google Maps, press Share, copy the link, and paste it here.",
  };
}

type MinimalResponse = { headers: { get(name: string): string | null } };
type FetchLike = (url: string, init: RequestInit) => Promise<MinimalResponse>;

/**
 * Resolves a Google share link to its coordinates. SERVER ONLY.
 *
 * THE REDIRECT IS READ, NEVER FOLLOWED — redirect: "manual", then the Location
 * header is treated as text. That is what stops a user-supplied URL becoming an
 * SSRF primitive: the only hosts this ever connects to are the three hardcoded
 * Google short-link domains above, and wherever the redirect points is a string
 * to search for digits in, not somewhere to go.
 *
 * Times out rather than hanging a form submit on someone else's outage, and a
 * failure says "paste the full link instead" — never a silently absent pin.
 */
export async function resolveMapInput(
  raw: string,
  fetchImpl?: FetchLike,
): Promise<MapInputParse> {
  const first = parseMapInput(raw);
  if (first.kind !== "short-link") return first;

  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    return {
      kind: "error",
      message: "Could not open that short link. Paste the full Google Maps link instead.",
    };
  }

  try {
    const res = await doFetch(first.url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Hallnect/1.0 (+https://hallnect.com)" },
    });
    const location = res.headers.get("location");
    if (!location) {
      return {
        kind: "error",
        message:
          "That short link did not lead anywhere we could read. Open it, then copy the full link from the address bar.",
      };
    }
    // One hop, then stop. A short link redirecting to another short link is
    // reported rather than chased.
    const resolved = parseMapInput(location);
    if (resolved.kind === "short-link") {
      return {
        kind: "error",
        message: "That link redirects more than once. Open it, then copy the full link from the address bar.",
      };
    }
    if (resolved.kind === "empty") {
      return { kind: "error", message: "That short link did not contain a location." };
    }
    return resolved;
  } catch {
    return {
      kind: "error",
      message:
        "Could not open that short link just now. Open it yourself, then copy the full link from the address bar.",
    };
  }
}

/** The link shown back to an owner for a pin already saved. */
export function mapsLinkFor(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}
