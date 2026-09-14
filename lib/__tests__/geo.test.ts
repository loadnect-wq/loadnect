import { describe, it, expect } from "vitest";
import { parseMapInput, resolveMapInput, checkCoordinates, mapsLinkFor, VENUE_BOUNDS } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────────────────────
// The map pin.
//
// These are behaviour tests against real strings Google Maps actually produces,
// not source-level invariants: the whole feature IS the parsing, and every one
// of these shapes came out of the same Share button.
//
// The failure mode worth most of the effort here is not "no pin" — it is a
// CONFIDENTLY WRONG pin, because that one ships to Google inside a
// GeoCoordinates node and tells the world the venue is somewhere it is not.
// ─────────────────────────────────────────────────────────────────────────────

// Madurai, roughly the Meenakshi temple.
const MADURAI = { latitude: 9.9195, longitude: 78.1193 };

const coords = (r: ReturnType<typeof parseMapInput>) =>
  r.kind === "coords" ? r.value : null;

describe("parseMapInput — the shapes Google actually hands out", () => {
  it("prefers the place's own coordinate (!3d/!4d) over the viewport centre (@)", () => {
    // A desktop place URL carries BOTH, and they differ whenever the user
    // panned before copying. !3d/!4d is the pin; @ is wherever the map happened
    // to be looking. Taking the wrong one puts the venue up the road.
    const url =
      "https://www.google.com/maps/place/Meenakshi+Amman+Temple/@9.9250000,78.1250000,17z/" +
      "data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d9.9195!4d78.1193";
    expect(coords(parseMapInput(url))).toEqual(MADURAI);
  });

  it("reads ?q=lat,lng", () => {
    expect(coords(parseMapInput("https://maps.google.com/?q=9.9195,78.1193"))).toEqual(MADURAI);
  });

  it("reads the Maps URL API ?api=1&query= form", () => {
    const url = "https://www.google.com/maps/search/?api=1&query=9.9195%2C78.1193".replace("%2C", ",");
    expect(coords(parseMapInput(url))).toEqual(MADURAI);
  });

  it("reads ll=", () => {
    expect(coords(parseMapInput("https://maps.google.com/maps?ll=9.9195,78.1193&z=17"))).toEqual(MADURAI);
  });

  it("falls back to the @ viewport centre when nothing better is present", () => {
    expect(coords(parseMapInput("https://www.google.com/maps/@9.9195,78.1193,15z"))).toEqual(MADURAI);
  });

  it("accepts coordinates pasted on their own", () => {
    expect(coords(parseMapInput("9.9195, 78.1193"))).toEqual(MADURAI);
    expect(coords(parseMapInput("9.9195,78.1193"))).toEqual(MADURAI);
  });

  it("treats blank as blank, not as an error", () => {
    // Clearing the field is how an owner REMOVES a wrong pin. If that read as
    // an error they could never take one back off.
    expect(parseMapInput("").kind).toBe("empty");
    expect(parseMapInput("   ").kind).toBe("empty");
  });

  it("rounds to the six decimals the column actually stores", () => {
    const r = coords(parseMapInput("9.91951234567, 78.11931234567"));
    expect(r).toEqual({ latitude: 9.919512, longitude: 78.119312 });
  });
});

describe("a wrong pin is refused, not stored", () => {
  it("refuses a pin outside Tamil Nadu and says what to do about it", () => {
    // The Googleplex — what you get by pasting a link left over from something
    // else entirely.
    const r = parseMapInput("https://maps.google.com/?q=37.4220,-122.0841");
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toContain("outside Tamil Nadu");
  });

  it("refuses coordinates that are not a place on Earth", () => {
    const r = parseMapInput("120.5, 900.2");
    expect(r.kind).toBe("error");
  });

  it("refuses text with no location in it", () => {
    for (const junk of ["my venue", "https://example.com/venue", "call me on 9344040013"]) {
      expect(parseMapInput(junk).kind).toBe("error");
    }
  });

  it("does not mistake digits in a shortened path for coordinates", () => {
    // THE REASON SHORT LINKS ARE DETECTED FIRST. "maps.app.goo.gl/9r1x2,78k"
    // would match the plain-coordinates pattern on a less careful reading, and
    // a slug is not a location.
    const r = parseMapInput("https://maps.app.goo.gl/9.9195,78.1193");
    expect(r.kind).toBe("short-link");
  });

  it("swapped latitude and longitude land outside the bounds and are caught", () => {
    // 78.1193 is not a latitude anywhere, let alone in Tamil Nadu.
    const r = parseMapInput("78.1193, 9.9195");
    expect(r.kind).toBe("error");
  });
});

describe("checkCoordinates", () => {
  it("accepts the corners of the allowed box and rejects just outside", () => {
    const { minLat, maxLat, minLng, maxLng } = VENUE_BOUNDS;
    expect(checkCoordinates(minLat, minLng)).toBeNull();
    expect(checkCoordinates(maxLat, maxLng)).toBeNull();
    expect(checkCoordinates(minLat - 0.1, minLng)).not.toBeNull();
    expect(checkCoordinates(maxLat, maxLng + 0.1)).not.toBeNull();
  });

  it("covers the cities the site actually lists", () => {
    // Chennai, Madurai, Coimbatore, Kanyakumari (the southern tip) and
    // Hosur (the northern border) must all be inside.
    for (const [lat, lng] of [
      [13.0827, 80.2707], [9.9252, 78.1198], [11.0168, 76.9558],
      [8.0883, 77.5385], [12.7409, 77.8253],
    ]) {
      expect(checkCoordinates(lat, lng), `${lat},${lng}`).toBeNull();
    }
  });

  it("rejects NaN rather than storing it", () => {
    expect(checkCoordinates(Number.NaN, 78)).not.toBeNull();
  });
});

describe("resolveMapInput — share links", () => {
  const headers = (loc: string | null) => ({ headers: { get: () => loc } });

  it("reads the redirect target without ever following it", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return headers(
        "https://www.google.com/maps/place/Venue/@9.92,78.12,17z/data=!4m2!3m1!8m2!3d9.9195!4d78.1193",
      );
    };

    const r = await resolveMapInput("https://maps.app.goo.gl/abc123", fake);
    expect(coords(r)).toEqual(MADURAI);

    // ONE request, to the short-link host, with redirects off. If this ever
    // becomes redirect:"follow" the resolver turns into an SSRF primitive
    // pointed at whatever a stranger put in the Location header.
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://maps.app.goo.gl/abc123");
    expect(seen[0].init.redirect).toBe("manual");
    expect(seen[0].init.method).toBe("HEAD");
  });

  it("does not chase a second hop", async () => {
    const fake = async () => headers("https://maps.app.goo.gl/another");
    const r = await resolveMapInput("https://maps.app.goo.gl/abc123", fake);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toContain("redirects more than once");
  });

  it("reports a network failure instead of silently dropping the pin", async () => {
    // Saving with no pin because Google timed out, and saying nothing, is how
    // an owner ends up believing they set a location they did not.
    const fake = async () => { throw new Error("ETIMEDOUT"); };
    const r = await resolveMapInput("https://maps.app.goo.gl/abc123", fake);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toContain("Could not open that short link");
  });

  it("reports a redirect with no Location header", async () => {
    const fake = async () => headers(null);
    const r = await resolveMapInput("https://maps.app.goo.gl/abc123", fake);
    expect(r.kind).toBe("error");
  });

  it("still applies the bounds check to whatever the redirect resolved to", async () => {
    const fake = async () => headers("https://www.google.com/maps/@37.4220,-122.0841,17z");
    const r = await resolveMapInput("https://maps.app.goo.gl/abc123", fake);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toContain("outside Tamil Nadu");
  });

  it("passes a non-short link straight through without any request", async () => {
    let called = false;
    const fake = async () => { called = true; return headers(null); };
    const r = await resolveMapInput("https://maps.google.com/?q=9.9195,78.1193", fake);
    expect(coords(r)).toEqual(MADURAI);
    expect(called).toBe(false);
  });
});

describe("mapsLinkFor", () => {
  it("round-trips through parseMapInput", () => {
    const link = mapsLinkFor(MADURAI.latitude, MADURAI.longitude);
    expect(coords(parseMapInput(link))).toEqual(MADURAI);
  });
});
