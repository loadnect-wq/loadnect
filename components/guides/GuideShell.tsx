// ─────────────────────────────────────────────────────────────────────────────
// The frame every planning guide shares (lib/guides.ts): breadcrumb, language
// link, H1, the answer in the first lines, the date, the FAQ and what to read
// next. A server component; each guide supplies only its own body.
//
// THE MARKUP IS BUILT FROM WHAT THE PAGE PRINTS. The Article headline is the
// H1, its dates are the "Updated" line, and the FAQPage is the same array the
// visible questions render from — so the structured data cannot say anything
// the reader does not see.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Languages } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { articleJsonLd, breadcrumbJsonLd, faqJsonLd, jsonLdGraph } from "@/lib/seo/jsonld";
import { formatDiaryDay } from "@/lib/diary";
import { GUIDES_PATH, guidePath, type Guide, type GuideLang } from "@/lib/guides";

export type GuideFaq = { q: string; a: string };
export type RelatedLink = { href: string; label: string; note: string };

const T = {
  en: {
    home: "Home",
    guides: "Guides",
    updated: (d: string) => `Updated ${d}`,
    by: "Written by Hallnect",
    faq: "Questions families ask",
    next: "Read next",
    switchLabel: "தமிழில் படிக்க",
    switchLang: "ta" as const,
    crumbLabel: "Breadcrumb",
  },
  ta: {
    home: "முகப்பு",
    guides: "வழிகாட்டிகள்",
    updated: (d: string) => `புதுப்பிக்கப்பட்டது: ${d}`,
    by: "Hallnect எழுதியது",
    faq: "குடும்பங்கள் கேட்கும் கேள்விகள்",
    next: "அடுத்து படிக்க",
    switchLabel: "Read in English",
    switchLang: "en" as const,
    crumbLabel: "வழிச்சுவடு",
  },
} as const;

export function GuideShell({
  guide,
  lang,
  lead,
  faqs,
  related,
  children,
}: {
  guide: Guide;
  lang: GuideLang;
  /** The answer, in the first lines — what a reader or an answer engine should take away if they read nothing else. */
  lead: string;
  faqs: readonly GuideFaq[];
  related: readonly RelatedLink[];
  children: ReactNode;
}) {
  const t = T[lang];
  const text = guide[lang];
  const path = guidePath(guide.slug, lang);

  return (
    <article className="container-app max-w-3xl pb-16 pt-3 lg:pt-8">
      <JsonLd
        data={jsonLdGraph(
          articleJsonLd({
            path,
            headline: text.heading,
            description: text.description,
            inLanguage: lang === "ta" ? "ta-IN" : "en-IN",
            datePublished: guide.published,
            dateModified: guide.updated,
          }),
          breadcrumbJsonLd([
            { name: t.home, path: "/" },
            { name: t.guides, path: GUIDES_PATH[lang] },
            { name: text.heading, path },
          ]),
          ...(faqs.length ? [faqJsonLd([...faqs])] : []),
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t.crumbLabel}>
          <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-600">
            <li><Link href="/" className="hover:text-maroon-700">{t.home}</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href={GUIDES_PATH[lang]} className="hover:text-maroon-700">{t.guides}</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-charcoal-800" aria-current="page">{text.heading}</li>
          </ol>
        </nav>
        <Link
          href={guidePath(guide.slug, t.switchLang)}
          hrefLang={t.switchLang === "ta" ? "ta-IN" : "en-IN"}
          lang={t.switchLang}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-maroon-700 hover:underline"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t.switchLabel}
        </Link>
      </div>

      <h1
        className={`mt-1 text-2xl font-bold leading-snug text-charcoal-900 lg:text-3xl ${lang === "en" ? "font-serif" : ""}`}
      >
        {text.heading}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-charcoal-800">{lead}</p>
      <p className="mt-3 text-xs text-charcoal-600">
        <time dateTime={guide.updated}>{t.updated(formatDiaryDay(lang, guide.updated, { year: true }))}</time>
        {" · "}
        {t.by}
      </p>

      <div className="mt-8 space-y-10">{children}</div>

      {faqs.length > 0 && (
        <section className="mt-10" aria-labelledby="guide-faq">
          <h2 id="guide-faq" className="text-lg font-bold text-charcoal-900">{t.faq}</h2>
          <dl className="mt-3 space-y-4">
            {faqs.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-charcoal-900">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-charcoal-700">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {related.length > 0 && (
        <nav className="mt-10" aria-labelledby="guide-next">
          <h2 id="guide-next" className="text-lg font-bold text-charcoal-900">{t.next}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="group flex h-full flex-col rounded-2xl bg-white p-4 shadow-card ring-1 ring-border transition-colors hover:ring-maroon-300"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold text-charcoal-900">
                    {r.label}
                    <ArrowRight className="h-4 w-4 shrink-0 text-maroon-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="mt-1 text-xs leading-relaxed text-charcoal-600">{r.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}

/** A guide section: an H2 and its body. */
export function GuideSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20 lg:scroll-mt-24">
      <h2 id={id} className="text-xl font-bold text-charcoal-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-charcoal-700">{children}</div>
    </section>
  );
}
