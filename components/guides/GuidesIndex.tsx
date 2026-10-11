// ─────────────────────────────────────────────────────────────────────────────
// /guides and /ta/guides — the list of planning guides (lib/guides.ts), plus
// the muhurtham dates page, which is the "this month" guide in all but name.
// The CollectionPage markup lists exactly the cards the page shows.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowRight, CalendarHeart, Languages } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, jsonLdGraph, WEBSITE_ID } from "@/lib/seo/jsonld";
import { absoluteUrl } from "@/lib/seo/config";
import { GUIDES_INDEX_TEXT, GUIDES_PATH, guidePath, guideText, guidesIn, type GuideLang } from "@/lib/guides";
import { MUHURTHAM_PATH } from "@/components/muhurtham/MuhurthamPage";

const T = {
  en: {
    home: "Home",
    crumbLabel: "Breadcrumb",
    muhurtham: "Muhurtham dates this month",
    muhurthamNote: "This month's Tamil wedding dates and the year ahead, with how many halls are already booked on each.",
    switchLabel: "தமிழில் படிக்க",
    switchLang: "ta" as const,
    groups: { families: "For families", owners: "For hall owners" },
  },
  ta: {
    home: "முகப்பு",
    crumbLabel: "வழிச்சுவடு",
    muhurtham: "இந்த மாத முகூர்த்த நாட்கள்",
    muhurthamNote: "இந்த மாதமும் வரும் ஆண்டும் திருமண முகூர்த்த நாட்கள், ஒவ்வொரு நாளிலும் ஏற்கனவே முன்பதிவான மண்டபங்களுடன்.",
    switchLabel: "Read in English",
    switchLang: "en" as const,
    groups: { families: "குடும்பங்களுக்கு", owners: "மண்டப உரிமையாளர்களுக்கு" },
  },
} as const;

type Audience = "families" | "owners";
type Card = { href: string; title: string; note: string; audience: Audience };

/** Every card, in the order the page shows them: families' guides and the muhurtham page, then owners'. */
export function guidesIndexCards(lang: GuideLang): Card[] {
  const guides = guidesIn(lang).map((g) => ({
    href: guidePath(g.slug, lang),
    title: guideText(g, lang).heading,
    note: guideText(g, lang).card,
    audience: g.audience,
  }));
  return [
    ...guides.filter((c) => c.audience === "families"),
    { href: MUHURTHAM_PATH[lang], title: T[lang].muhurtham, note: T[lang].muhurthamNote, audience: "families" as const },
    ...guides.filter((c) => c.audience === "owners"),
  ];
}

export function GuidesIndex({ lang }: { lang: GuideLang }) {
  const t = T[lang];
  const text = GUIDES_INDEX_TEXT[lang];
  const path = GUIDES_PATH[lang];
  const url = absoluteUrl(path);
  const cards = guidesIndexCards(lang);

  return (
    <div className="container-app max-w-3xl pb-16 pt-3 lg:pt-8">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "CollectionPage",
            "@id": `${url}#collection`,
            url,
            name: text.heading,
            description: text.description,
            inLanguage: lang === "ta" ? "ta-IN" : "en-IN",
            isPartOf: { "@id": WEBSITE_ID },
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: cards.length,
              itemListElement: cards.map((c, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: c.title,
                url: absoluteUrl(c.href),
              })),
            },
          },
          breadcrumbJsonLd([
            { name: t.home, path: "/" },
            { name: text.heading, path },
          ]),
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t.crumbLabel}>
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">{t.home}</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">{text.heading}</li>
          </ol>
        </nav>
        <Link
          href={GUIDES_PATH[t.switchLang]}
          hrefLang={t.switchLang === "ta" ? "ta-IN" : "en-IN"}
          lang={t.switchLang}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-maroon-700 hover:underline"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t.switchLabel}
        </Link>
      </div>

      <h1 className={`mt-1 text-2xl font-bold leading-snug text-charcoal-900 lg:text-3xl ${lang === "en" ? "font-serif" : ""}`}>
        {text.heading}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-charcoal-800">{text.lead}</p>

      {(["families", "owners"] as const).map((audience) => {
        const group = cards.filter((c) => c.audience === audience);
        if (group.length === 0) return null;
        return (
          <section key={audience} aria-labelledby={`guides-${audience}`} className="mt-8">
            <h2 id={`guides-${audience}`} className="text-lg font-bold text-charcoal-900">{t.groups[audience]}</h2>
            <ul className="mt-3 grid gap-3">
              {group.map((c) => (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    className="group flex items-start gap-3 rounded-2xl bg-white p-5 shadow-card ring-1 ring-border transition-colors hover:ring-maroon-300"
                  >
                    {c.href === MUHURTHAM_PATH[lang] && <CalendarHeart className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold text-charcoal-900">{c.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-charcoal-700">{c.note}</span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-maroon-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
