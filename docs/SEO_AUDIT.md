# Hallnect — SEO Audit

**Audited:** 2026-09-13 · **Domain:** https://hallnect.com · **Stack:** Next.js 16 App Router, React 19, Supabase, Vercel (syd1)

Method: seven parallel audits of the repository (metadata, indexability, sitemap/robots, structured data, architecture/linking, images/CWV, content/local), each required to cite `file:line`, plus direct measurement of the live site — all 13 indexable URLs fetched and their titles, descriptions, canonicals, OG tags and robots directives extracted.

---

## 0. The fact that governs everything

**There is one approved venue, in one city.**

The live sitemap contains 13 URLs: the homepage, `/halls`, `/about`, `/premium`, `/owner/register`, `/contact`, six legal pages, `/wedding-halls/madurai`, and one venue page.

This is not a technical-SEO problem. It is the whole problem. The site is technically well built and has almost nothing to rank *with*. Every recommendation below is scaled to that reality, and the largest available win is not in this document — it is signing up venues, and verifying the Google Business Profile.

---

## 1. Current status — what is already right

This was **not** a greenfield implementation. A mature SEO layer already existed and most of it is correct. Recorded here so it does not get "fixed":

| Area | Evidence |
|---|---|
| One metadata builder | `lib/seo/metadata.ts:54-90` — canonical, robots, full Open Graph and Twitter card cannot be forgotten on a new page |
| Canonicals | `lib/seo/config.ts:43-50` — `absoluteUrl()` strips query and hash; verified live, 13/13 self-canonical to the apex |
| Filter crawl-trap closed | `app/halls/page.tsx` — ten filter params, zero indexable permutations |
| Inventory-gated city pages | `lib/seo/cities.ts` — 18 service areas render, only those with venues are indexable. No doorway pages |
| Draft venues cannot leak | `app/halls/[slug]/page.tsx:35-36` — an owner/admin preview of an unapproved hall returns noindex |
| Private surfaces | Real `noindex` declared once per subtree layout, not robots.txt alone. Verified live: `/admin`, `/customer`, `/owner/dashboard`, `/enquiry/*` all 307 → `/login` **and** send `noindex, nofollow` |
| No PII on public pages | `lib/halls.ts:572-581` explicit column list, never `select("*")`; reviews fetch no profile join; seller block pinned to the three fields the E-Commerce Rules require |
| No fabricated data | No `sameAs` (no verified social profile exists), no `aggregateRating` without real ratings, no invented geo |
| Venue OG image | Uses the venue's own 1600×900 photo, not the site default |

---

## 2. Findings

40 findings: **1 critical, 11 high, 18 medium, 10 low.** One requires the owner rather than code.

### Critical

**C1 — A swallowed DB error silently marked the only city landing page `noindex`** · `lib/seo/cities.ts:104`
`fetchCityInventory()` returned `[]` on a query error, and `fetchCityInventoryBySlug` turns an absent city into `{ venueCount: 0, indexable: false }`. One transient error was enough to re-render `/wedding-halls/madurai` as `noindex` — the only page targeting the query this business exists to win. **Fixed:** three states instead of two; indexability callers use a strict reader that throws. Both routes are ISR, so a throw during revalidation keeps the last good render.

### High

| # | Finding | Status |
|---|---|---|
| H1 | `fetchIndexableVenues` fail-open emptied the sitemap behind a 200 — publishing "these URLs are gone" | **Fixed** (throws) |
| H2 | City page FAQ promised an availability calendar and online payment, **in `FAQPage` structured data**, that no listed venue offers | **Fixed** (branches on real booking mode) |
| H3 | Homepage title carried no brand — a layout's `title.template` does not apply to a page in its own segment | **Fixed** |
| H4 | Six meta descriptions shipped cut mid-phrase by the 158-char clamp | **Fixed** (shortened + budgeted) |
| H5 | Venue description repeated the name then cut at "located in…" | **Fixed** (whole-sentence budgeting) |
| H6 | `/halls` went `noindex` on **any** query string — `?fbclid=`, `?utm_source=` | **Fixed** (named filter keys) |
| H7 | Venue photo lazy-loaded on both listing pages while being the LCP element | **Fixed** (`eager` + `fetchPriority` on card 0) |
| H8 | Mobile homepage above-the-fold held at `opacity: 0` until hydration | **Fixed** (moved to keyframe path) |
| H9 | Homepage How-It-Works and FAQ described a checkout no live listing performs | **Fixed** |
| H10 | Venue page emitted a `BreadcrumbList` it did not render, and linked to its city page nowhere | **Fixed** |
| H11 | Venue description is 25 words and stops mid-word | **Owner action** — see §4 |

### Medium (18) — all fixed except where noted

`priceRange` is not a valid property of `EventVenue` (removed); venue node was an orphan in the JSON-LD graph (`isPartOf` added); city `ItemList` referenced venues by bare URL rather than `@id` (fixed); `addressRegion` published the owner's free-text spelling "Tamilnadu" (normalised); `/contact` rendered full NAP with no structured data (Organization added); robots.txt blocked `/login`, `/signup`, `/book/` which carry `noindex` and are linked — blocking them *preserves* unwanted listings because Googlebot never reads the noindex (unblocked); `/halls` linked to no city page (Browse-by-city block added); mobile city tiles pointed at the noindexed `/halls?city=` (repointed); two titles printed the brand twice (fixed); `/halls` filtered view sent `noindex` **and** a cross-canonical, a contradictory pair (canonical dropped on that branch); both logos carried `priority`, taking the only image preloads on `/halls` (removed); `/about` did not exist (**created**); `venue_types` is stored and rendered nowhere crawlable (**deferred**, §3); no venue can have coordinates — no input exists (**deferred**, §3); eight of nine venue photos have generated alt text because no UI can set `alt_text` (**deferred**, §3); venue OG image is the raw 233 KB original with no declared dimensions (**deferred**, §3); `AdSlot` ships raw `<img>` with a remote src the site's own CSP blocks (**deferred**, §3); six of thirteen `lastmod` dates regenerate hourly (**deferred**, §3).

### Low (10)

`html lang="en"` contradicted the declared `en-IN` (fixed); `/pricing` was an orphan redirecting 307 (now a 308 in `next.config.ts`, page deleted); `/halls` skipped h1→h3 (sr-only h2 added); AVIF not enabled (enabled); `fade` variant issues and remaining items are cosmetic or deferred with reasons in §3.

---

## 3. Deliberately not done, with reasons

**The brief's page list.** It asks for `/marriage-halls-in-madurai`, `/wedding-halls-in-madurai`, `/reception-halls-in-madurai`, `/event-halls-in-madurai`, plus Coimbatore and Chennai equivalents, plus a blog.

With one venue: the Coimbatore and Chennai pages would have nothing on them, and four Madurai variants would be four near-identical pages listing the same hall. The brief forbids this itself — *"Do not create hundreds of useless doorway pages"*, *"only where there is sufficient real content"*, *"Do not generate duplicate pages targeting nearly identical keywords"*, *"Never mass-create hundreds of empty locality pages."*

The architecture already does the right thing: `lib/seo/cities.ts` renders all 18 service areas but marks them `noindex` and keeps them out of the sitemap until they hold inventory, at which point they flip automatically with no code change. **Adding a venue in Coimbatore publishes `/wedding-halls/coimbatore` by itself.** That is the correct shape; empty pages shipped today would be a liability.

**A blog.** No content system exists; it would be built from scratch. For a site with 14 indexable URLs and one venue, editorial content is not the constraint — inventory is. Revisit when there are venues to link articles *to*, because that is where a guide's SEO value actually comes from.

**Deferred engineering, in priority order** (each is real, none is urgent at one venue):
1. **Alt-text UI** (`ImagesManager.tsx`) — the `alt_text` column is persisted by the action but no input sets it, so eight of nine photos use generated fallbacks. Additive, no schema change.
2. **`opengraph-image.tsx` for venue pages** — compose a 1200×630 card instead of serving the 233 KB original.
3. **`venue_types` rendered as text** — required, stored, invisible to crawlers.
4. **`lastmod` honesty** — six static entries regenerate hourly; derive from real sources.
5. **Latitude/longitude input** — the schema builder reads them; nothing can set them.
6. **`AdSlot` → `next/image`** — currently a raw `<img>` whose remote src the CSP blocks.

---

## 4. Owner actions — cannot be done in code

| Action | Why it matters | Status |
|---|---|---|
| **Verify the Google Business Profile** | Profile `04707753343253147703` exists but is unverified, so **nothing on it reaches Search or Maps**. This is the single largest local-SEO lever available | Blocked on you — see `LOCAL_SEO_SETUP.md` |
| **Add venues** | The binding constraint on every metric in this document | Ongoing |
| **Rewrite the venue description** | `NS KHALYAANA MAHAL`'s description is 25 words and stops mid-word. The venue page is one of two pages that can rank, and this is its only unique prose | Needs the owner |
| **Search Console property + sitemap** | Nothing is measurable until this exists | See `SEARCH_CONSOLE_SETUP.md` |
| **Bing Webmaster Tools** | Import from Search Console once it exists | See `BING_WEBMASTER_SETUP.md` |

---

## 5. Regression protection

`lib/__tests__/seo-invariants.test.ts` — 63 assertions, no network, no database, runs with the suite. They assert *properties*, not current values, so they survive legitimate copy changes:

- every indexable page builds metadata through `buildMetadata`
- no two share a title or description
- no description exceeds the 158-char clamp (this is what would have caught H4)
- the homepage title carries the brand; no other page prints it twice
- robots.txt blocks the private subtrees and does **not** block URLs that depend on `noindex` being readable
- nothing in the sitemap is disallowed by robots.txt
- the indexability readers are the strict ones, and the strict one throws (this is what would have caught C1 and H1)
- `EventVenue` carries no `priceRange`, is never multi-typed as `LocalBusiness`, emits `aggregateRating` only with real ratings, declares no `sameAs`

One of these caught a brand-duplication defect in the `/about` page during the same session it was written.
