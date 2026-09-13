# SEO monitoring — Hallnect

Three layers: what the test suite catches before deploy, what to check after deploy, and what to watch monthly.

---

## 1. Before deploy — automated, already wired

`lib/__tests__/seo-invariants.test.ts` runs with `npm test`. 63 assertions, no network, no database. It asserts properties rather than current values, so ordinary copy changes do not break it.

It fails the build if someone:

- adds an indexable page that does not use `buildMetadata` (so it would ship with no canonical)
- duplicates a title or description across indexable pages
- writes a description longer than the 158-character clamp — i.e. one that ships to Google cut off mid-phrase
- removes the brand from the homepage title, or prints it twice on any other page
- disallows `/login`, `/signup` or `/book/` in robots.txt — those carry `noindex` and are linked, so blocking them stops Googlebot reading the noindex and *preserves* the unwanted listing
- puts a sitemap URL behind a robots.txt Disallow
- reverts either indexability read to the fail-open version that returns `[]` on a database error
- adds `priceRange` to the `EventVenue` node, multi-types it as `LocalBusiness`, emits `aggregateRating` without real ratings, or adds a `sameAs` for a social profile that does not exist

The last two groups are the ones with teeth: the fail-open defect silently de-indexed the only city page, and contradictory structured data is the realistic way this site earns a manual action.

## 2. After each deploy — two minutes

The sitemap and robots are generated at runtime from live data, so they are worth eyeballing after a deploy that touches inventory, SEO or the database layer.

```bash
curl -s https://hallnect.com/sitemap.xml | grep -c '<loc>'
```

**Expect 14.** A sharp drop is an incident, not a cosmetic issue — an empty or shrunken sitemap tells Google those URLs are gone. The fail-open fix means a failed read now throws and ISR keeps serving the previous sitemap, so a drop means something else.

```bash
curl -s https://hallnect.com/robots.txt
```

Confirm `Sitemap:` and `Host:` point at `https://hallnect.com` and that no public path is disallowed.

Spot-check that a page is indexable and self-canonical:

```bash
curl -s https://hallnect.com/wedding-halls/madurai | grep -oE '<(title|link rel="canonical"|meta name="robots")[^>]*>'
```

Wanted: a real title, `canonical` = the same absolute apex URL, `robots` = `index, follow`. **`noindex` here is the failure mode to watch for** — it is what a failed inventory read used to produce.

## 3. Monthly — ten minutes in Search Console

| Check | Healthy | Act when |
|---|---|---|
| Pages → indexed | climbing toward the sitemap count | a page that was indexed is dropped — read the stated reason |
| Pages → not indexed | small, with understood reasons | "Discovered – currently not indexed" on a commercial page persists past ~6 weeks |
| Sitemaps → discovered | 14 (or current inventory) | 0, or a sharp fall |
| Performance → impressions | rising slowly | flat at zero past ~8 weeks with pages indexed |
| Performance → CTR by page | — | a page with impressions and near-zero clicks: that is a title/description fix, and it is available today |
| Performance → queries | brand terms first, then category | queries arrive with no matching page — build the page, in that order |
| Core Web Vitals | needs ~28 days of field data | anything leaves "Good" |
| Manual actions | **empty** | anything at all — read it the same day |
| Security issues | **empty** | anything at all |

## 4. What not to chase

- **No traffic in month one.** A new domain with 14 URLs and one venue will show almost nothing for weeks. Judge the work on coverage and error counts, not sessions.
- **Rank-tracking tools.** At this size they report noise. Search Console's average position is free and honest.
- **Core Web Vitals before field data exists.** Lab scores from PageSpeed Insights are useful for debugging and are not what Search Console reports.

## 5. The number that actually matters

**Approved venues.** Every metric in this document is capped by it. Two venues in Coimbatore publish `/wedding-halls/coimbatore` automatically — a new indexable page, new internal links, a new set of winnable queries, with no code change.

If you track one number monthly, track that one.
