import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CITY_COVERS, LAUNCH_CITIES, POPULAR_CITIES } from "../content";
import { SERVICE_AREA_CITIES } from "../seo/service-areas";

// ─────────────────────────────────────────────────────────────────────────────
// The homepage city tiles.
//
// This strip has been wrong once already: it rendered a static list of eight
// cities, seven with no venues, and every tile promised halls and delivered an
// empty search. It now shows Chennai, Coimbatore and Tiruchirappalli again —
// on request — so these tests exist to keep them honest: a city with no venues
// must say "Coming soon", never "Explore", and must never be offered as a
// search option.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const page       = read("app/page.tsx");
const citiesRow  = read("app/_components/CitiesRow.tsx");
const heroSearch = read("components/sections/HeroSearch.tsx");

/** Strip comments — the notes in page.tsx quote the old copy on purpose. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = code(page);

describe("the launch cities", () => {
  it("are the four the owner asked for, in canonical spelling", () => {
    // "Tiruchirappalli", not "Trichy": /wedding-halls/trichy is a 404, and the
    // inventory query matches on the stored city name.
    expect([...LAUNCH_CITIES]).toEqual(["Madurai", "Chennai", "Coimbatore", "Tiruchirappalli"]);
  });

  it("are all declared service areas, so every tile's landing page exists", () => {
    for (const city of LAUNCH_CITIES) {
      expect(SERVICE_AREA_CITIES as readonly string[], `${city} has no landing page`).toContain(city);
    }
  });

  it("each have a brand gradient to fall back on", () => {
    for (const city of LAUNCH_CITIES) {
      expect(POPULAR_CITIES.some((p) => p.name === city), `${city} has no gradient`).toBe(true);
    }
  });
});

describe("a city with no venues cannot pretend to have them", () => {
  it("is labelled from the live count, not from the list", () => {
    expect(pageCode).toContain("c.venueCount === 0");
    expect(pageCode).toContain("live:     c.venueCount > 0");
  });

  it("says Coming soon instead of Explore on both breakpoints", () => {
    expect(pageCode).toMatch(/c\.live \? "Explore →" : "Coming soon"/);
    expect(citiesRow).toContain("!c.live");
    expect(citiesRow).toContain("Coming soon");
  });

  it("dropped the copy that would now be false", () => {
    // "Cities with venues… taking bookings today" above a Chennai tile with no
    // venues is exactly the lie this strip used to tell.
    expect(pageCode).not.toContain("taking bookings today");
    expect(pageCode).not.toContain('title="Cities with venues"');
  });

  it("hides the strip when the inventory read FAILED, rather than relabelling it", () => {
    // On success the inventory always includes every service-area city, so an
    // empty array means the query failed. Treating that as "no venues" would
    // show Madurai as Coming soon.
    expect(pageCode).toContain("const inventoryRead = cityInventory.length > 0");
    expect(pageCode).toContain("inventoryRead ? [...citiesWithVenues, ...comingSoon] : []");
  });

  it("is never offered as a search option", () => {
    // The tiles may advertise a launch; a search box may not — picking Chennai
    // there would still return nothing.
    expect(pageCode).toContain("<HeroSearch cities={citiesWithVenues.map((c) => c.city)}");
    expect(pageCode).toContain("<HomeLocation cities={citiesWithVenues}");
    expect(heroSearch).not.toContain("LAUNCH_CITIES");
  });
});

describe("the cover photos", () => {
  it("are same-origin and actually shipped", () => {
    // The CSP's img-src is 'self' plus Supabase; a hotlinked photo renders as
    // an empty box.
    for (const [city, src] of Object.entries(CITY_COVERS)) {
      expect(src, `${city} cover is not same-origin`).toMatch(/^\/cities\//);
      expect(fs.existsSync(path.join(ROOT, "public", src!)), `public${src} missing`).toBe(true);
    }
  });

  it("are a web-sized JPEG, not the 2.2 MB PNG they started as", () => {
    const bytes = fs.statSync(path.join(ROOT, "public/cities/madurai.jpg")).size;
    expect(bytes).toBeLessThan(400 * 1024);
  });

  it("get a heavier shade, because the photo is bright where the name sits", () => {
    // Measured: white text scored 4.13:1 over the Madurai photo under the
    // gradient tiles' /55 shade, against a 4.5 bar. /80 gives 6.46:1.
    expect(pageCode).toContain('c.image ? "from-black/80 via-black/30"');
    expect(citiesRow).toContain('c.image ? "from-black/80 via-black/30"');
  });

  it("go through next/image, so a phone gets a tile-sized file", () => {
    expect(pageCode).toContain('sizes="292px"');
    expect(citiesRow).toContain('sizes="160px"');
  });
});
