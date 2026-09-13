# Google Search Console — setup for Hallnect

Nothing in this file can be done by Claude: Google requires a signed-in human, and verification is deliberately not automatable. Budget 20 minutes.

Sign in as **loadnect@gmail.com** — the same account that owns the Google Business Profile and GA4 (`G-4YVQGMTCR4`), so the properties can be linked later.

---

## 1. Add the property

Go to https://search.google.com/search-console and choose **Domain** (not URL-prefix).

Enter `hallnect.com`.

**Why Domain and not URL-prefix:** a Domain property covers `http`, `https`, the apex, `www` and every subdomain in one place. Hallnect's canonical host is the apex and `www.hallnect.com` 301s to it — a URL-prefix property would silently miss the `www` variant and any future subdomain.

## 2. Verify by DNS

Google will show a `TXT` record like `google-site-verification=…`.

Add it wherever `hallnect.com`'s DNS is managed (Vercel, if the domain is managed there: **Project → Settings → Domains → hallnect.com → DNS Records**):

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `@` (the apex, not `www`) |
| Value | the exact string Google shows |
| TTL | default |

Save, wait a few minutes, then click **Verify**. If it fails, wait 15 minutes and retry — DNS propagation, not a mistake.

> Do not delete this record afterwards. Google re-checks it periodically and removing it un-verifies the property.

## 3. Submit the sitemap

**Sitemaps** → enter `sitemap.xml` → Submit.

The full URL is `https://hallnect.com/sitemap.xml`. It is generated from live inventory (`app/sitemap.ts`, revalidates hourly), so it does not need resubmitting when venues are added — Google re-fetches it on its own schedule.

Expect **13 discovered URLs** today. If it ever reports 0 or drops sharply, that is a real incident: see `SEO_MONITORING.md`.

## 4. Inspect the homepage

**URL Inspection** → paste `https://hallnect.com/` → Enter.

Check, in this order:
1. **URL is on Google** — or "URL is not on Google", which is normal for a new property.
2. **Coverage → Indexing allowed?** must be **Yes**.
3. **Test live URL** → **View tested page → Screenshot**. Confirm the page renders with content, not a blank frame. This is the check that catches JavaScript-gated content.
4. **More info → Page resources** — nothing important should be blocked.

## 5. Request indexing for the pages that matter

Use **URL Inspection → Request Indexing** on these five, in this order. Do not submit all 13; the quota is limited and the rest will be found through the sitemap and internal links.

1. `https://hallnect.com/`
2. `https://hallnect.com/wedding-halls/madurai`
3. `https://hallnect.com/halls/ns-khalyaana-mahal-madurai`
4. `https://hallnect.com/owner/register`
5. `https://hallnect.com/about`

**Why this order:** 2 and 3 are the only two pages that can win a commercial query today. 4 is the page whose entire job is winning inventory, which is the real constraint on everything else.

Requesting indexing is a hint, not a command. It typically takes days to weeks for a new domain.

## 6. What to expect, honestly

A new domain with 14 URLs and one venue will show **almost no impressions for weeks**. That is not a fault to debug. The sequence is: pages get discovered → indexed → start appearing for long-tail brand and name queries → then, if inventory grows, for category queries.

Do not conclude the SEO work failed because there is no traffic in month one. Judge it on: are the pages indexed, is coverage clean, are there zero errors.

## 7. Link GA4

**Settings → Associations → Google Analytics** → link the `G-4YVQGMTCR4` property. This puts Search Console query data inside GA4 reports. Optional, and useful once there is traffic.

## 8. Standing checks

Set aside ten minutes a month:

- **Pages** — indexed count, and the reason for anything excluded
- **Performance** — queries, pages, CTR, average position
- **Core Web Vitals** — needs ~28 days of field data before it reports anything
- **Manual actions** — must stay empty. Structured data that contradicts a page is the realistic way to earn one here, which is why `lib/__tests__/seo-invariants.test.ts` pins those invariants
- **Security issues** — must stay empty

`SEO_MONITORING.md` covers what to do when a number moves.
