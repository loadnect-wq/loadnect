import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INDEXNOW_KEY, indexNowEnabled, indexNowPayload } from "../indexnow";
import { organizationJsonLd } from "../seo/jsonld";
import { buildLlmsTxt } from "../seo/llms";
import { LISTING_CHECKS } from "../seo/definition";
import { SOCIAL_PROFILES } from "../constants";

// ─────────────────────────────────────────────────────────────────────────────
// AI visibility (2026-10-12). The audit found the site itself sound; what was
// missing was the brand's links to the rest of the web and any channel to
// Bing, whose index ChatGPT search and Copilot answer from. Searching
// "hallnect" on Google was being corrected to "halonext".
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("the brand's profiles: one list, visible and machine-readable alike", () => {
  it("lists only the confirmed Instagram profile, as a clean canonical URL", () => {
    expect(SOCIAL_PROFILES).toEqual([
      { network: "Instagram", handle: "@hallnect.official", url: "https://www.instagram.com/hallnect.official/" },
    ]);
    for (const p of SOCIAL_PROFILES) expect(p.url).not.toMatch(/[?#]/); // no share-tracking parameters
  });

  it("the Organization publishes them as sameAs, with the site's one-line description", () => {
    const org = organizationJsonLd() as { sameAs?: string[]; description?: string };
    expect(org.sameAs).toEqual(SOCIAL_PROFILES.map((p) => p.url));
    expect(org.description).toMatch(/^Hallnect is an online marketplace for wedding halls/);
  });

  it("the footer visibly links every profile it publishes (structured data matches the page)", () => {
    const footer = read("components/layout/Footer.tsx");
    expect(footer).toContain("SOCIAL_PROFILES.map(");
    expect(footer).toContain("href={p.url}");
    expect(footer).toContain('rel="me noopener noreferrer"');
  });
});

describe("llms.txt", () => {
  const txt = buildLlmsTxt({
    siteUrl: "https://hallnect.com",
    generatedOn: "2026-10-12",
    venues: [],
    cities: [],
    directBookingEnabled: true,
    feeDisclosure: "₹100 platform fee plus 18% GST (₹118)",
    supportHours: "every day, 9 AM – 9 PM IST",
    contact: { legalName: "HALLNECT LLP", email: "e@x", phone: "+91 1", address: "Madurai" },
  } as Parameters<typeof buildLlmsTxt>[0]);

  it("says the team visits SOME venues, and never again that it visits none", () => {
    expect(txt).toContain(LISTING_CHECKS);
    expect(LISTING_CHECKS).toMatch(/visits some venues in person, but not every one/);
    expect(txt).not.toMatch(/does not visit venues/);
  });

  it("links the Instagram profile", () => {
    expect(txt).toContain("- Instagram: [@hallnect.official](https://www.instagram.com/hallnect.official/)");
  });

  it("the site assistant says the same about visits, and that owners can join by mobile", () => {
    const kb = read("lib/ai/knowledge.server.ts");
    expect(kb).toContain("${LISTING_CHECKS}");
    expect(kb).not.toMatch(/does not visit venues/);
    expect(kb).toMatch(/continue with Google or a mobile number/);
  });
});

describe("IndexNow", () => {
  const savedEnv = process.env.VERCEL_ENV;
  afterEach(() => { process.env.VERCEL_ENV = savedEnv; });

  it("serves its key from public/<key>.txt, containing exactly the key", () => {
    const files = readdirSync(join(root, "public")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
    expect(files).toEqual([`${INDEXNOW_KEY}.txt`]);
    expect(readFileSync(join(root, "public", files[0]), "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("sends only hallnect.com URLs, once each, pointing IndexNow at the key file", () => {
    const body = indexNowPayload([
      "https://hallnect.com/halls",
      "https://hallnect.com/halls",
      "https://evil.example/halls",
      "not a url",
      "https://hallnect.com/halls/madras-hall-chennai",
    ]);
    expect(body).toEqual({
      host: "hallnect.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://hallnect.com/${INDEXNOW_KEY}.txt`,
      urlList: ["https://hallnect.com/halls", "https://hallnect.com/halls/madras-hall-chennai"],
    });
    expect(indexNowPayload(["https://evil.example/x"])).toBeNull();
  });

  it("is silent everywhere but production", () => {
    process.env.VERCEL_ENV = "preview";
    expect(indexNowEnabled()).toBe(false);
    delete process.env.VERCEL_ENV;
    expect(indexNowEnabled()).toBe(false);
    process.env.VERCEL_ENV = "production";
    expect(indexNowEnabled()).toBe(true);
  });

  it("is sent after every venue change, without making the change wait", () => {
    const src = read("lib/revalidate-venues.ts");
    expect(src).toContain("after(notifyVenueChanges)");
  });
});
