# Bing Webmaster Tools — setup for Hallnect

Bing powers Bing, Yahoo, DuckDuckGo (partly) and Ecosia. In India its share is small next to Google, so this is worth twenty minutes once — not ongoing attention.

**Do Google Search Console first** (`SEARCH_CONSOLE_SETUP.md`). Bing can import the whole property from it, which turns a 20-minute job into a 3-minute one.

## 1. Sign in and import

https://www.bing.com/webmasters — sign in with **loadnect@gmail.com**.

Choose **Import from Google Search Console**, authorise, and pick `hallnect.com`. Bing copies the verified property, the sitemap submission and the settings.

If import is unavailable, add the site manually as `https://hallnect.com` and verify with the DNS `TXT` record Bing provides — same procedure as the Google record, added alongside it at the apex.

## 2. Confirm the sitemap

**Sitemaps** should already list `https://hallnect.com/sitemap.xml` after an import. If not, submit it.

## 3. IndexNow — skip it for now

Bing offers IndexNow for instant submission on publish. It is a real feature and it is not worth wiring up at one venue: it needs a key file, an endpoint call on every approval, and error handling, to accelerate the indexing of a page that is published a few times a month. Revisit when venues are being approved daily; the natural hook is the existing `revalidatePath` call in the admin approval action.

## 4. What to check, twice a year

- **Site Explorer** — are the 14 URLs known?
- **SEO Reports** — Bing runs its own on-page checks and occasionally flags something Google does not
- **Crawl information** — 4xx/5xx Bing has hit

## 5. What not to do

Do not submit the site to "50+ search engines" services. Beyond Google and Bing, every other engine either uses one of their indexes or is too small to matter, and those services are a spam signal in themselves.
