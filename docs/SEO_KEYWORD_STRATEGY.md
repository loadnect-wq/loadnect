# Keyword strategy — Hallnect

**Read §1 before §2.** A keyword list written against inventory you do not have is a plan to build doorway pages.

---

## 1. What can actually be targeted today

One approved venue, in Madurai. That gives exactly two commercially useful landing pages:

| URL | Realistic target |
|---|---|
| `/wedding-halls/madurai` | "wedding halls in madurai", "marriage halls in madurai" |
| `/halls/ns-khalyaana-mahal-madurai` | "ns khalyaana mahal", "ns khalyaana mahal madurai" |

Plus the brand and supply sides, which are winnable *now* and are usually ignored:

| URL | Target |
|---|---|
| `/` | "hallnect" — brand and near-brand. Most early clicks come from here |
| `/owner/register` | "list my wedding hall", "list marriage hall online", "wedding hall listing site india" |
| `/about` | "hallnect llp", "is hallnect legit", "hallnect madurai" |

**The supply-side keyword set is the highest-leverage one on this list.** Every venue signed up unlocks a city page, several long-tails, and internal links. Demand-side keywords are capped by inventory; supply-side keywords are what raise the cap.

## 2. The full map, for when inventory exists

Each tier below should be targeted **only when the page backing it has real content**. The architecture already enforces this: a city page is `noindex` and out of the sitemap until it holds a venue, then flips automatically.

### Tier 1 — city head terms (needs ≥3 venues in that city)
`marriage halls in {city}` · `wedding halls in {city}` · `function halls in {city}` · `reception halls in {city}` · `wedding venues in {city}`
→ **one page per city**: `/wedding-halls/{city}`. Not four pages per city. These are synonyms for one intent, and Google treats them as such; four pages would compete with each other.

Cities in priority order, which is inventory order, not population order: Madurai (live), then wherever venues actually sign up. Chennai and Coimbatore are in `SERVICE_AREA_CITIES` and will publish themselves on first approval.

### Tier 2 — long-tail modifiers (needs enough venues to filter meaningfully)
`ac marriage halls in {city}` · `marriage halls with parking in {city}` · `wedding halls for 500 people in {city}` · `affordable marriage halls in {city}` · `marriage hall booking {city}`

These map to **filter combinations**, not to new URLs. `/halls?city=…&capacity=…` is deliberately `noindex`. Only promote a filter to its own indexable page when it has a stable set of venues and content of its own — thin filter pages are the classic programmatic-SEO trap.

### Tier 3 — locality (needs ≥3 venues in that locality)
`marriage halls near {locality}` — e.g. Thirupparankundram, Anna Nagar. **Do not build these yet.** One venue per locality is a thin page by definition.

### Tier 4 — informational
`how to choose a marriage hall`, `marriage hall booking checklist`, `how much does a marriage hall cost in madurai`.

Worth building **after** there is inventory to link to, because a guide's SEO value comes largely from the internal links it sends to commercial pages. A guide on a site with one venue has almost nothing to point at.

## 3. Intent and language

Searchers in Tamil Nadu mix English, Tamil and Tanglish. Notes:

- **"marriage hall" outranks "wedding hall" in Indian usage.** Both appear in the current titles and descriptions, which is correct.
- **Tanglish** (`kalyana mandapam`, `thirumana mandapam`) is genuine search behaviour. Use it only where it reads naturally in real copy — a venue whose name or description contains it, or an FAQ answer. Do not sprinkle transliterations into titles; that is keyword stuffing in a second language.
- **Tamil script** would need genuinely translated pages and an `hreflang` setup. Not worth it at 14 URLs. Revisit if Search Console shows Tamil-script queries arriving.

## 4. Rules this site follows

- One page per intent, never one page per synonym.
- A page is created when it has content, not when a keyword is identified.
- Keywords appear in titles, descriptions and headings **because they describe the page**, not to hit a density.
- No page claims a venue attribute the venue did not supply. The audit found the city FAQ promising an availability calendar that no listed venue has — the cost of writing copy for a keyword instead of for the truth.

## 5. Measuring

Once Search Console has data (see `SEARCH_CONSOLE_SETUP.md`), the useful question is not "are we ranking for X" but:

1. Which queries already bring impressions? Those are the ones Google thinks this site is about.
2. Which pages get impressions but few clicks? A title/description problem, fixable today.
3. Which queries arrive that have **no** matching page? That is the signal to build one — demand first, page second. It is the opposite of how the brief's page list was written, and it is the order that avoids doorway pages.
