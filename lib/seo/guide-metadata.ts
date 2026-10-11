// ─────────────────────────────────────────────────────────────────────────────
// Metadata for the planning guides (lib/guides.ts). One place applies the
// Tamil review gate: an unreviewed Tamil page is noindex and, because
// buildMetadata emits canonical and hreflang only on indexable pages, it
// nominates nothing either.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import {
  GUIDES_INDEX_TEXT,
  GUIDES_PATH,
  guideBySlug,
  guideIndexable,
  guideLanguageAlternates,
  guidePath,
  guidesIndexIndexable,
  guidesIndexLanguageAlternates,
  type GuideLang,
} from "@/lib/guides";

export function guideMetadata(slug: string, lang: GuideLang): Metadata {
  const g = guideBySlug(slug);
  return buildMetadata({
    title: g[lang].title,
    description: g[lang].description,
    path: guidePath(slug, lang),
    type: "article",
    indexable: guideIndexable(g, lang),
    languages: guideLanguageAlternates(g),
    ...(lang === "ta" ? { locale: "ta_IN" } : {}),
  });
}

export function guidesIndexMetadata(lang: GuideLang): Metadata {
  return buildMetadata({
    title: GUIDES_INDEX_TEXT[lang].title,
    description: GUIDES_INDEX_TEXT[lang].description,
    path: GUIDES_PATH[lang],
    indexable: guidesIndexIndexable(lang),
    languages: guidesIndexLanguageAlternates(),
    ...(lang === "ta" ? { locale: "ta_IN" } : {}),
  });
}
