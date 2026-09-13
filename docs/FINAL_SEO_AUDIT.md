# Hallnect — Final SEO Audit

**Date:** 2026-09-13 · **Scope:** audit of the existing SEO layer, implementation of the fixes, verification.

Read `SEO_AUDIT.md` first for the findings. This is the scorecard and what remains.

---

## Scores

| Area | Score | Verdict |
|---|---:|---|
| Technical SEO | **95** | Strong before this work; stronger now |
| Indexability | **96** | The two fail-open reads were the only real hole |
| Structured data | **94** | Valid, non-contradictory, nothing fabricated |
| Internal linking | **90** | Breadcrumbs, city links and footer now complete |
| Performance | **88** | LCP fixed; two deferred items |
| Social SEO | **85** | Complete tags; no composed OG card |
| On-page SEO | **82** | Capped by one venue with 25 words of prose |
| Image SEO | **72** | Alt text is generated, not authored — no UI exists |
| Content architecture | **60** | Right architecture, almost no content |
| Local SEO | **55** | GBP is unverified. Nothing else moves this number |
| Security | **95** | CSP, headers, RLS, no PII on public pages |

Below is every score under 90, with the reason and what would move it.

### Performance — 88
**Why not higher:** the venue OG image is the raw 233 KB original with no declared dimensions, and `AdSlot` renders a raw `<img>` whose remote src the site's own CSP blocks — so ad creatives silently fail to load on four public surfaces.
**Fixed this pass:** the LCP photo on both listing pages was lazy-loaded and is now `eager` + `fetchPriority="high"` on the first card only; both header logos carried `priority` and were taking the only image preloads on `/halls`; AVIF enabled ahead of WebP; the mobile homepage's entire first screen was held at `opacity: 0` until hydration.
**To reach 95:** add `app/halls/[slug]/opengraph-image.tsx` (composed 1200×630 card), move ad creatives into the existing Supabase bucket and render them with `next/image`.

### Social SEO — 85
**Why not higher:** every page uses either the site default OG image or the venue's raw photo. No page composes a card with the venue name and city on it, which is what earns a click from a WhatsApp share — the dominant sharing channel for this audience.
**Already correct:** complete Open Graph and Twitter tags on all 14 URLs, `summary_large_image`, venue pages using their own photo, and no invented `twitter:site` handle.
**To reach 95:** the `opengraph-image.tsx` route above.

### On-page SEO — 82
**Why not higher:** `NS KHALYAANA MAHAL`'s description is **25 words and stops mid-word**. The venue page is one of only two pages that can win a commercial query, and that is its only unique prose. No code change can fix this.
**Fixed this pass:** six meta descriptions were shipping cut off mid-phrase; the homepage had no brand in its title; two pages printed the brand twice; the venue description now budgets whole sentences instead of clamping mid-clause.
**To reach 92:** the owner rewrites that description to 120–250 words of real detail — dining layout, parking, A/C, stage, changing rooms, catering, proximity to Thirupparankundram. Nothing invented.

### Image SEO — 72
**Why not higher:** eight of the venue's nine photos carry *generated* alt text, because the `alt_text` column is persisted by the action but **no UI can set it**. Generated alt is honest and distinct — far better than the identical string every image once shared — but it cannot describe what is actually in the photo.
**To reach 90:** add a short text input per image in `ImagesManager.tsx`, wired to the `altText` field the action already accepts. No schema change, no read-path change, generated text stays as the default. Then the owner writes nine real descriptions.

### Content architecture — 60
**Why not higher:** 14 indexable URLs and one venue. This is not an architecture problem — the architecture is right, and it is the reason the score is not lower. `lib/seo/cities.ts` renders all 18 service areas, marks them `noindex`, keeps them out of the sitemap, and flips them automatically the moment a city holds a venue.
**What would move it:** venues. Two venues in Coimbatore publish `/wedding-halls/coimbatore` with no code change.
**What would NOT move it:** building the `/marriage-halls-in-{city}` pages the brief asked for. With one venue those are empty doorway pages and four near-duplicates — which the brief itself forbids. See `SEO_AUDIT.md` §3.

### Local SEO — 55
**Why not higher, and this is the whole answer:** the Google Business Profile (`04707753343253147703`) exists, is correctly configured, and is **unverified** — so nothing on it reaches Search or Maps. For a local wedding-venue marketplace, that is the single largest lever available, and it is worth more than everything else in this document combined.
**Already correct:** NAP is consistent between the GBP and the site, and the site's values come from one constant that `/contact`, `/about` and the JSON-LD all read. `Organization`, `areaServed`, `ContactPoint` and `OpeningHoursSpecification` are live. The venue is typed `EventVenue`, not `LocalBusiness`, so it does not contradict the GBP's service-area registration.
**To reach 85:** verify the profile. `LOCAL_SEO_SETUP.md` §1 has the video-verification specifics, including why first attempts usually fail.

---

## What was implemented

**Correctness**
- Two fail-open reads closed. `lib/seo/cities.ts` and `lib/seo/sitemap-data.ts` returned `[]` on a database error; one error silently marked the only city page `noindex` and emptied the sitemap behind a 200. Now three states, with indexability callers on a strict reader that throws — and both routes are ISR, so a throw keeps the last good render.
- The city page's FAQ promised an availability calendar and online payment, **in `FAQPage` structured data**, that no listed venue offers. Both answers now branch on the real booking mode. The homepage's How-It-Works and three FAQ answers had the same problem.

**Metadata** — homepage title now carries the brand; six truncated descriptions fixed at source; the venue description budgets whole sentences; two double-brand titles corrected; `html lang` is `en-IN`.

**Indexability** — `/halls` no longer goes `noindex` on `?fbclid=` or `?utm_source=`; the filtered branch no longer sends `noindex` *and* a cross-canonical; `/login`, `/signup`, `/book/` unblocked in robots.txt so their `noindex` can actually be read; `/pricing` is a 308 in `next.config.ts` instead of an orphan 307.

**Structure** — visible breadcrumb on the venue page mirroring the `BreadcrumbList` it already emitted; venue page now links to its city page; `/halls` gained a Browse-by-city block from live inventory; mobile city tiles repointed from the noindexed filter URL to the landing page; `/halls` no longer skips h1→h3.

**Schema** — `priceRange` removed (not valid on `EventVenue`); venue node declares `isPartOf` the WebSite; city `ItemList` references venues by `@id`; `addressRegion` normalised; `Organization` added to `/contact`.

**Performance** — eager LCP image, logos de-prioritised, AVIF enabled, mobile hero off the hydration gate.

**New** — `/about`, built only from constants the site already publishes.

**Tests** — `lib/__tests__/seo-invariants.test.ts`, 63 assertions. Test count 626 → **689**.

## Verification performed

- `npm test` — **689 passed (30 files)**
- `npm run build` — compiled successfully
- `npx tsc --noEmit` — clean
- `npm run lint` — **61 warnings**, unchanged baseline
- Browser: `/about`, `/halls` and the venue page at 375 and 1280 — no horizontal overflow; heading hierarchy h1→h2→h3; visible breadcrumb matches the structured one rung for rung; `EventVenue` node confirmed to carry no `priceRange`, no fabricated rating, `isPartOf` present, `addressRegion` normalised
- Live pre-work baseline: all 13 URLs fetched, titles/descriptions/canonicals/OG/robots extracted; private routes confirmed 307→`/login` with `noindex, nofollow`

**Note on the local sitemap:** it renders empty on `localhost` and in a local build. That is `isPublishableUrl` working — it requires `https:` and rejects `localhost`, so no preview host can ever ship a sitemap. Production resolves to the apex and is unaffected.

## Remaining risks

1. **The GBP stays unverified.** Local visibility is zero until it is done.
2. **Inventory.** Every ceiling in this document is the same ceiling.
3. **A venue could be approved with a poor description**, and description quality is now the main on-page lever. Worth a line in the admin approval checklist.
4. **`aggregateRating` appears at the first review.** It is correctly gated on real ratings — but one 5-star review rendering as a perfect aggregate is technically true and practically misleading. Worth a minimum-count threshold before it is emitted.
5. **Deferred engineering** is listed in `SEO_AUDIT.md` §3, in priority order.

## What is not claimed

No ranking is claimed or guaranteed. Nothing here makes Google index a page faster than it chooses to; requesting indexing is a hint. A new domain with 14 URLs and one venue should be expected to show almost no impressions for weeks — the honest early measures are coverage, error counts, and whether the two commercial pages are indexed at all.
