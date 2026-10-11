// ─────────────────────────────────────────────────────────────────────────────
// lib/guides.ts — the planning guides at /guides, and their Tamil twins at
// /ta/guides. Pure data, safe on the client and the server.
//
// ONE LIST. The guide pages, the index, the sitemap, /llms.txt and the tests
// all read this, so a guide cannot be published in one place and forgotten in
// another.
//
// WHERE THE TOPICS CAME FROM (SEO phase 7, 2026-10-11). Google autocomplete for
// India, in English and Tamil — searches families actually type — matched to
// facts this site already holds: the planner's expense categories, the
// published refund schedule, the fields a hall's quote carries. A guide states
// nothing the product cannot back. No invented prices or averages.
//
// ═══ TAMIL IS INDEXED ONLY AFTER A NATIVE SPEAKER HAS READ IT ═══════════════
//
// Every guide has a Tamil twin, written carefully but not by a native speaker.
// Until someone who is has checked it, `taReviewed` stays false and the Tamil
// page is served `noindex, follow`, left out of the sitemap, and not named by
// the English page's hreflang. Readers can still open it from the language
// link. Flipping the flag is the whole of publishing it.
// ─────────────────────────────────────────────────────────────────────────────

export type GuideLang = "en" | "ta";

export const GUIDES_PATH = { en: "/guides", ta: "/ta/guides" } as const;

type GuideText = {
  /** <title> without " | Hallnect" (the template adds it; fitTitle drops it when long). */
  title: string;
  /** Meta description, ≤155 characters. */
  description: string;
  /** The H1 and the Article headline. */
  heading: string;
  /** One line for the index card. */
  card: string;
};

export type Guide = {
  slug: string;
  audience: "families" | "owners";
  /** YYYY-MM-DD, India time. */
  published: string;
  /** YYYY-MM-DD: the last change to the guide's TEXT. Shown on the page and used as its sitemap date. */
  updated: string;
  /** A native Tamil speaker has checked the Tamil twin. See the header. */
  taReviewed: boolean;
  en: GuideText;
  ta: GuideText;
};

export const GUIDES: readonly Guide[] = [
  {
    slug: "wedding-expense-list",
    audience: "families",
    published: "2026-10-11",
    updated: "2026-10-11",
    taReviewed: false,
    en: {
      title: "Tamil Wedding Expense List: Budget Checklist",
      description:
        "Every cost of a Tamil wedding on one list: hall, food, decoration, photos, nadaswaram, thamboolam and more, with how to price each line yourself.",
      heading: "Tamil wedding expense list",
      card: "Every cost of the wedding in one list, and how to price each line with real quotes.",
    },
    ta: {
      title: "திருமண செலவு பட்டியல்",
      description:
        "திருமணத்தின் எல்லாச் செலவுகளும் ஒரே பட்டியலில்: மண்டபம், சாப்பாடு, அலங்காரம், புகைப்படம், நாதஸ்வரம், தாம்பூலம் — ஒவ்வொன்றுக்கும் விலை கேட்கும் முறையுடன்.",
      heading: "திருமண செலவு பட்டியல்",
      card: "திருமணத்தின் எல்லாச் செலவுகளும் ஒரே பட்டியலில், ஒவ்வொன்றுக்கும் விலை கேட்கும் முறையுடன்.",
    },
  },
  {
    slug: "before-you-pay-a-hall-advance",
    audience: "families",
    published: "2026-10-11",
    updated: "2026-10-11",
    taReviewed: false,
    en: {
      title: "Before You Pay a Hall Advance: What to Ask",
      description:
        "What to ask a wedding hall and get in writing before you pay the advance: the price, what it includes, GST, timings, the balance and the refund terms.",
      heading: "Before you pay a hall advance",
      card: "Twelve things to ask a hall, and what to get in writing, before any money changes hands.",
    },
    ta: {
      title: "மண்டப முன்பணம் கட்டும் முன் கேட்க வேண்டியவை",
      description:
        "மண்டபத்துக்கு முன்பணம் கட்டும் முன் கேட்க வேண்டியவையும் எழுத்தில் வாங்க வேண்டியவையும்: விலை, அதில் அடங்குபவை, GST, நேரம், மீதித் தொகை, ரத்து விதிகள்.",
      heading: "மண்டபத்துக்கு முன்பணம் கட்டும் முன்",
      card: "பணம் கொடுக்கும் முன் மண்டபத்திடம் கேட்க வேண்டிய பன்னிரண்டு கேள்விகளும், எழுத்தில் வாங்க வேண்டியவையும்.",
    },
  },
];

/** The /guides index, in both languages. */
export const GUIDES_INDEX_TEXT = {
  en: {
    title: "Wedding & Function Planning Guides",
    description:
      "Guides for families planning a wedding or function in Tamil Nadu: the full expense list, what to ask before paying a hall advance, and muhurtham dates.",
    heading: "Planning guides",
    lead: "Plain answers to the questions families ask while planning a wedding or a function in Tamil Nadu. Every fact comes from how Hallnect works or from a source we name, and none of them is a price we cannot back.",
  },
  ta: {
    title: "திருமண, விழா திட்டமிடல் வழிகாட்டிகள்",
    description:
      "தமிழ்நாட்டில் திருமணம் அல்லது விழா திட்டமிடும் குடும்பங்களுக்கு: முழுச் செலவுப் பட்டியல், மண்டப முன்பணத்துக்கு முன் கேட்க வேண்டியவை, முகூர்த்த நாட்கள்.",
    heading: "திட்டமிடல் வழிகாட்டிகள்",
    lead: "தமிழ்நாட்டில் திருமணம் அல்லது விழா திட்டமிடும்போது குடும்பங்கள் கேட்கும் கேள்விகளுக்கு எளிய பதில்கள். ஒவ்வொரு தகவலும் Hallnect செயல்படும் விதத்திலிருந்தோ, நாங்கள் குறிப்பிடும் ஆதாரத்திலிருந்தோ வருகிறது; உறுதிப்படுத்த முடியாத விலை எதுவும் இல்லை.",
  },
} as const;

export function guideBySlug(slug: string): Guide {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) throw new Error(`Unknown guide: ${slug}`);
  return g;
}

export function guidePath(slug: string, lang: GuideLang): string {
  return `${GUIDES_PATH[lang]}/${slug}`;
}

/** Is this language's page meant for search engines? English always; Tamil once reviewed. */
export function guideIndexable(g: Guide, lang: GuideLang): boolean {
  return lang === "en" || g.taReviewed;
}

/**
 * hreflang for a guide, or undefined while the Tamil twin is unreviewed — an
 * hreflang pointing at a noindex page is a contradiction search engines flag.
 */
export function guideLanguageAlternates(g: Guide): Record<string, string> | undefined {
  if (!g.taReviewed) return undefined;
  return {
    "en-IN": guidePath(g.slug, "en"),
    "ta-IN": guidePath(g.slug, "ta"),
    "x-default": guidePath(g.slug, "en"),
  };
}

/** The Tamil index is indexable once it lists at least one reviewed guide. */
export function guidesIndexIndexable(lang: GuideLang): boolean {
  return lang === "en" || GUIDES.some((g) => g.taReviewed);
}

export function guidesIndexLanguageAlternates(): Record<string, string> | undefined {
  if (!guidesIndexIndexable("ta")) return undefined;
  return { "en-IN": GUIDES_PATH.en, "ta-IN": GUIDES_PATH.ta, "x-default": GUIDES_PATH.en };
}
