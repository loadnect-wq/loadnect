import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  VENUE_CATEGORY_GROUPS,
  ORIGINAL_VENUE_TYPE_SLUGS,
  categoryLabelMap,
  categoryVenueLabel,
  categoryVenuePhrase,
  findCategory,
  groupCategories,
  isVenueCategoryGroup,
  isVenueCategorySlug,
  joinCategoryNouns,
  selectCategories,
  sortCategories,
  type VenueCategory,
} from "@/lib/venue-categories";
import { occasionTiles } from "@/components/sections/OccasionDiscovery";
import { CATEGORY_ICON_NAMES } from "@/components/venues/CategoryIcon";

// ─────────────────────────────────────────────────────────────────────────────
// The multi-purpose venue catalogue (migration 0102).
//
// Hallnect was a wedding-hall marketplace whose vocabulary was four values
// hard-coded in five places and pinned by three CHECK constraints. It is now a
// table an admin edits, and these tests cover the three things that expansion
// could plausibly have broken:
//
//   1. BACKWARD COMPATIBILITY. The four original slugs must survive, active, or
//      every existing hall stops validating and every indexed page 404s.
//   2. THE FAIL-OPEN FILTER. A category with no inventory must return nothing,
//      never everything — the defect migration 0037 was written for.
//   3. THE NULL BUCKET. "no occasion recorded" must stay distinguishable from
//      every real occasion, in perpetuity, or the analytics lie.
//
// The SQL assertions pin migration text rather than running it. The migration
// carries its own DO-block verification, which is what proves it against a real
// Postgres; this file is the cheap, always-run half.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function cat(
  slug: string,
  name: string,
  pluralNoun: string,
  displayOrder: number,
  group: VenueCategory["group"] = "celebrations",
): VenueCategory {
  return { slug, name, pluralNoun, description: null, icon: null, group, isActive: true, displayOrder };
}

const CATALOGUE: VenueCategory[] = [
  cat("wedding", "Wedding", "weddings", 110),
  cat("birthday-party", "Birthday Party", "birthday parties", 150),
  cat("party", "Party", "parties", 200),
  cat("meeting", "Meeting", "meetings", 310, "corporate"),
  cat("exhibition", "Exhibition", "exhibitions", 560, "community"),
];

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE MIGRATION
// ═════════════════════════════════════════════════════════════════════════════

describe("migration 0102 — the venue category catalogue", () => {
  const sql = read("supabase/migrations/0102_venue_categories.sql");
  // Comments are stripped so an assertion cannot be satisfied by prose that
  // merely DESCRIBES the statement.
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("keeps the four original types, so every existing hall still validates", () => {
    // The whole migration is additive or it is a data-loss event: these four
    // slugs are in live halls.venue_types arrays, in leads.event_type, and in
    // the URLs of the only pages that currently rank.
    for (const slug of ORIGINAL_VENUE_TYPE_SLUGS) {
      expect(code).toContain(`('${slug}',`);
    }
    // And the verify block refuses to let a partial apply through quietly.
    expect(code).toMatch(/the four original venue types are not all present and active/);
  });

  it("seeds without clobbering an admin's later edits", () => {
    // Re-running must not undo a rename, a reorder or a deactivation.
    expect(code).toContain("on conflict (slug) do nothing");
  });

  it("replaces all three hard-coded vocabularies with the shared validator", () => {
    expect(code).toContain("drop constraint if exists halls_venue_types_allowed");
    expect(code).toContain("drop constraint if exists admin_hall_drafts_venue_types_allowed");
    // leads' check was inline in 0073, so its generated name is discovered.
    expect(code).toMatch(/pg_get_constraintdef\(con\.oid\) ilike '%event_type%'/);

    for (const trg of [
      "trg_halls_venue_types",
      "trg_hall_drafts_venue_types",
      "trg_leads_event_type",
      "trg_bookings_event_type",
    ]) {
      expect(code, trg).toContain(`create trigger ${trg}`);
    }
  });

  it("runs every validator as its owner with a pinned search_path", () => {
    // THE 0096/0099 LESSON. A SECURITY INVOKER trigger function that reads a
    // table the calling role cannot reach raises 42501 for session-client
    // writes — an owner saving their hall — while service-role writes sail
    // through. That defect only ever shows up for real users.
    for (const fn of [
      "assert_venue_categories",
      "validate_hall_venue_types",
      "validate_hall_draft_venue_types",
      "validate_lead_event_type",
      "validate_booking_event_type",
    ]) {
      const body = code.slice(code.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 900), fn).toContain("security definer");
      expect(body.slice(0, 900), fn).toContain("set search_path = public, pg_temp");
    }
    expect(code).toMatch(/expected 5 SECURITY DEFINER validators with a pinned search_path/);
  });

  it("keeps the validators off the API surface (0092)", () => {
    for (const fn of [
      "assert_venue_categories\\(text\\[\\], text\\[\\]\\)",
      "validate_hall_venue_types\\(\\)",
      "validate_booking_event_type\\(\\)",
    ]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${fn} from`));
    }
    expect(code).not.toMatch(/grant\s+execute[^;]*assert_venue_categories/i);
  });

  it("lets a hall KEEP a category that was later retired", () => {
    // The asymmetric rule, and the reason a plain foreign key would not do.
    // Had this been "every slug must be active", the first deactivation would
    // have locked every owner using that category out of their own edit form —
    // silently, and discovered by them rather than by us.
    expect(code).toContain("existing text[] default '{}'::text[]");
    expect(code).toMatch(/not \(s = any\(coalesce\(existing/);
    expect(code).toContain("venue category is no longer offered");
  });

  it("revokes the schema's inherited grants BEFORE granting anything", () => {
    // THE DEFECT THE FIRST APPLY FAILED ON. Supabase ships default privileges
    // that grant anon AND authenticated `arwdxtm` on every table created in
    // public, so `create table` alone left anon with table-wide INSERT/UPDATE
    // and made the column list below a no-op — a table-level privilege covers
    // every column and a column-level grant only ever adds to it.
    //
    // Order is the whole assertion: the revoke must precede both grants.
    const revoke = code.indexOf("revoke all on public.venue_categories from anon, authenticated");
    const grantSelect = code.indexOf("grant select on public.venue_categories");
    const grantUpdate = code.indexOf("grant update (");
    expect(revoke).toBeGreaterThan(0);
    expect(grantSelect).toBeGreaterThan(revoke);
    expect(grantUpdate).toBeGreaterThan(revoke);
  });

  it("refuses to let the catalogue be deleted from a session client", () => {
    // Deactivation is the removal mechanism. A deleted row leaves slugs the
    // trigger then rejects, which is the lockout above by another route.
    // DELETE is never re-granted after the revoke above.
    expect(code).not.toMatch(/grant[^;]*\bdelete\b[^;]*on public\.venue_categories/);
    expect(code).not.toMatch(/create policy [a-z_]+ on public\.venue_categories\s+for delete/);
    expect(code).toMatch(/venue_categories is deletable by authenticated/);
    // And anon's inherited write access is asserted gone, not merely intended.
    expect(code).toMatch(/anon can write to venue_categories/);
  });

  it("makes the slug immutable through the API", () => {
    // It is stored on every hall, lead and booking, and it is in the URL of an
    // indexed page. Renaming it orphans halls and 404s the page.
    // A COLUMN LIST, NOT A REVOKE. `grant update` + `revoke update (slug)` is
    // the natural spelling and it does nothing: Postgres treats a table-level
    // privilege as covering every column, and a column-level revoke does not
    // carve a hole in it. So slug is absent from an explicit grant instead.
    expect(code).toMatch(/grant update \(\s*name, plural_noun/);
    expect(code).not.toMatch(/grant update \([^)]*slug/);
    expect(code).not.toMatch(/grant insert, update on public\.venue_categories/);
    expect(code).toMatch(/venue_categories\.slug is updatable by authenticated/);
  });

  it("reads active rows publicly and writes only as an admin", () => {
    expect(code).toContain("alter table public.venue_categories enable row level security");
    expect(code).toContain("for select using (is_active or public.is_admin())");
    expect(code).toMatch(/for insert with check \(public\.is_admin\(\)\)/);
    expect(code).toMatch(/for update using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  });

  it("adds bookings.event_type as nullable, unbackfilled and server-only", () => {
    // NULL means "not recorded". Backfilling it with 'wedding' would put a
    // guess into the analytics the column exists to feed, and it is the one
    // thing that cannot be undone later.
    expect(code).toContain("add column if not exists event_type text");
    expect(code).not.toMatch(/update public\.bookings\s+set event_type/i);
    expect(code).not.toMatch(/event_type text not null/);
    // 0046 revoked table-wide writes and re-granted a named column list;
    // event_type must stay out of it.
    expect(code).toMatch(/bookings\.event_type is client-writable/);
    expect(code).not.toMatch(/grant update \([^)]*event_type[^)]*\) on public\.bookings/);
  });

  it("indexes what the filters and the analytics actually run", () => {
    expect(code).toContain("create unique index if not exists uq_venue_categories_slug");
    expect(code).toContain("idx_venue_categories_active_order");
    expect(code).toContain("idx_bookings_event_type");
  });

  it("documents how to undo itself", () => {
    expect(sql).toContain("ROLLBACK:");
    expect(sql).toContain("drop table if exists public.venue_categories;");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1b. THE CURATION (0103)
// ═════════════════════════════════════════════════════════════════════════════

describe("migration 0103 — the ten offered occasions", () => {
  const sql = read("supabase/migrations/0103_curate_ten_occasions.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  /** The chosen ten, in the order they are meant to appear. */
  const TEN = [
    "wedding", "birthday-party", "party", "reception", "meeting",
    "conference", "engagement", "baby-shower", "other-event", "photoshoot",
  ];

  it("offers exactly these ten, in this order", () => {
    // Pinned as a list and an ORDER, because display_order is the only thing
    // deciding what a visitor sees first and it is easy to renumber by accident.
    const orders = TEN.map((slug) => {
      const m = code.match(new RegExp(`\\('${slug}',[^)]*?(\\d+)\\)`));
      expect(m, slug).toBeTruthy();
      return Number(m![1]);
    });
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(TEN.length);

    // And the migration asserts the same thing against the live table.
    expect(code).toContain("the offered list is %, expected %");
  });

  it("retires the rest by EXCLUSION, not by listing them", () => {
    // Naming the eighteen would let a category added between 0102 and this
    // migration survive as a nineteenth nobody chose.
    expect(code).toMatch(/update public\.venue_categories set is_active = false\s+where slug not in \(/);
  });

  it("deletes nothing — the retired rows stay for reactivation", () => {
    expect(code).not.toMatch(/delete\s+from\s+public\.venue_categories/i);
    expect(code).toContain("the catalogue should still hold all 28 rows");
  });

  it("renames two WITHOUT touching their slugs", () => {
    // A slug is stored on every hall, lead and booking and sits in
    // /venues/<slug>. Renaming one orphans halls and 404s a live URL — 0102
    // revokes the column grant precisely so this cannot happen by accident.
    expect(code).toMatch(/\('birthday-party',\s*'Birthday'/);
    expect(code).toMatch(/\('other-event',\s*'Event'/);
    expect(code).not.toMatch(/set[^;]*slug\s*=/i);
    expect(code).toContain("was not renamed (or its slug moved)");
  });

  it("refuses to strand a hall whose every category was retired", () => {
    // A listing may keep a retired category, but one left with ONLY retired
    // categories would vanish from every typed view silently.
    expect(code).toContain("now declare only retired categories");
  });

  it("uses only icons the renderer can actually resolve", () => {
    // An icon name outside CategoryIcon's fixed map renders the fallback, so a
    // typo here is a silent downgrade to a calendar glyph on the home page.
    const icons = [...code.matchAll(/'([A-Z][A-Za-z0-9]*)',\s*\d+\)/g)].map((m) => m[1]);
    expect(icons.length).toBe(TEN.length);
    for (const name of icons) {
      expect(CATEGORY_ICON_NAMES, `${name} is not in CategoryIcon's map`).toContain(name);
    }
  });

  it("documents how to undo itself", () => {
    expect(sql).toContain("ROLLBACK");
    expect(sql).toContain("set is_active = true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE FILTER
// ═════════════════════════════════════════════════════════════════════════════

describe("the category filter fails closed, not open", () => {
  const halls = read("lib/halls.ts");

  it("treats any non-commercial slug as a venue category", () => {
    // Before 0037 the filter compared against a fixed list and silently
    // DROPPED anything else — so "Party Halls" returned every hall on the
    // platform under a heading that said otherwise. Before 0102 that list was
    // four values, so the twenty-four new occasions would have done the same.
    expect(halls).toContain("function isVenueCategoryFilter");
    expect(halls).toContain('q.overlaps("venue_types", [filters.category])');
  });

  it("keeps premium, pro and budget out of the occasion overlap", () => {
    // They predate the venue types and mean a tier and a price band. Passed to
    // the overlap they would match no hall and quietly empty the page.
    expect(halls).toContain('const COMMERCIAL_CATEGORY_CHIPS = ["premium", "pro", "budget"] as const');
  });

  it("does not read the catalogue on the search path", () => {
    // An extra round trip to Sydney on the hottest query in the app, to answer
    // a question the database is about to answer anyway.
    expect(halls).not.toMatch(/fetchVenueCategor/);
  });

  it("accepts a slug's shape and nothing else", () => {
    expect(isVenueCategorySlug("birthday-party")).toBe(true);
    expect(isVenueCategorySlug("wedding")).toBe(true);
    for (const bad of ["Wedding", "birthday party", "birthday_party", "-a", "a-", "a", "a".repeat(49), 7, null]) {
      expect(isVenueCategorySlug(bad), String(bad)).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SELECTING, ORDERING AND WORDING
// ═════════════════════════════════════════════════════════════════════════════

describe("selectCategories", () => {
  it("returns catalogue order, not the order the owner ticked boxes in", () => {
    const a = selectCategories(["meeting", "wedding"], CATALOGUE).map((c) => c.slug);
    const b = selectCategories(["wedding", "meeting"], CATALOGUE).map((c) => c.slug);
    expect(a).toEqual(["wedding", "meeting"]);
    expect(a).toEqual(b);
  });

  it("drops a slug the catalogue no longer knows", () => {
    expect(selectCategories(["wedding", "nightclub"], CATALOGUE).map((c) => c.slug)).toEqual(["wedding"]);
  });

  it("is empty for an undeclared venue or an unreadable catalogue", () => {
    expect(selectCategories([], CATALOGUE)).toEqual([]);
    expect(selectCategories(null, CATALOGUE)).toEqual([]);
    expect(selectCategories(["wedding"], [])).toEqual([]);
  });
});

describe("sorting and grouping", () => {
  it("sorts by group, then display order, then name", () => {
    const shuffled = [CATALOGUE[4], CATALOGUE[2], CATALOGUE[3], CATALOGUE[0], CATALOGUE[1]];
    expect(sortCategories(shuffled).map((c) => c.slug)).toEqual([
      "wedding", "birthday-party", "party", "meeting", "exhibition",
    ]);
  });

  it("omits a group with nothing in it", () => {
    const groups = groupCategories(CATALOGUE);
    expect(groups.map((g) => g.group)).toEqual(["celebrations", "corporate", "community"]);
    expect(groups.every((g) => g.categories.length > 0)).toBe(true);
  });

  it("names exactly the four groups 0102's CHECK pins", () => {
    const sql = read("supabase/migrations/0102_venue_categories.sql");
    for (const g of VENUE_CATEGORY_GROUPS) expect(sql).toContain(`'${g}'`);
    expect(isVenueCategoryGroup("celebrations")).toBe(true);
    expect(isVenueCategoryGroup("weddings")).toBe(false);
  });
});

describe("wording", () => {
  it("joins nouns without an Oxford comma", () => {
    expect(joinCategoryNouns(CATALOGUE.slice(0, 1))).toBe("weddings");
    expect(joinCategoryNouns(CATALOGUE.slice(0, 2))).toBe("weddings and birthday parties");
    expect(joinCategoryNouns(CATALOGUE.slice(0, 3))).toBe("weddings, birthday parties and parties");
  });

  it("says nothing for an empty list rather than an empty string", () => {
    // null, so the caller renders NOTHING. "" is falsy too but invites a
    // template literal that prints a stray full stop on an indexed page.
    expect(joinCategoryNouns([])).toBeNull();
  });

  it("builds the page titles the landing pages use", () => {
    expect(categoryVenueLabel(CATALOGUE[1])).toBe("Birthday Party Halls");
    expect(categoryVenuePhrase(CATALOGUE[1])).toBe("birthday party halls");
  });

  it("maps slugs to names for card badges", () => {
    expect(categoryLabelMap(CATALOGUE)["birthday-party"]).toBe("Birthday Party");
    expect(categoryLabelMap([])["wedding"]).toBeUndefined();
  });

  it("finds by slug and returns null rather than undefined", () => {
    expect(findCategory("meeting", CATALOGUE)?.name).toBe("Meeting");
    expect(findCategory("nightclub", CATALOGUE)).toBeNull();
    expect(findCategory(null, CATALOGUE)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DISCOVERY IS GATED ON REAL INVENTORY
// ═════════════════════════════════════════════════════════════════════════════

describe("occasionTiles", () => {
  const inv = (m: Record<string, number>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, { venueCount: v }]));

  // THIS CONTRACT WAS DELIBERATELY INVERTED. The grid first dropped every
  // occasion with no inventory, by analogy with the Premium chip — which had
  // to be hidden because it advertised a tier no hall held. The analogy was
  // wrong for occasions: with two of twenty-eight showing, the home page
  // looked like the wedding-only site the expansion exists to replace.
  //
  // The defect that gating really guards against is a control that returns
  // EVERYTHING because the filter silently dropped a value (migration 0037).
  // These tiles filter correctly and land on a page that states plainly that
  // nothing is listed, so showing them costs a visitor nothing and tells them
  // what Hallnect is for. Indexability is gated separately and still is.

  it("shows every occasion, including the ones with no venue yet", () => {
    const tiles = occasionTiles(CATALOGUE, inv({ wedding: 3 }));
    expect(tiles).toHaveLength(CATALOGUE.length);
    expect(tiles.map((t) => t.slug)).toContain("exhibition");
  });

  it("still renders the whole catalogue when nothing at all is listed", () => {
    expect(occasionTiles(CATALOGUE, inv({})).map((t) => t.slug).sort())
      .toEqual(CATALOGUE.map((c) => c.slug).sort());
  });

  it("is empty only when the catalogue itself could not be read", () => {
    // The one case that must still render nothing — see OccasionDiscovery,
    // which returns null for an empty list.
    expect(occasionTiles([], inv({}))).toEqual([]);
  });

  it("leads with the most inventory, then catalogue order", () => {
    // Ordering carries the honesty the filter used to: what Hallnect can
    // actually deliver today comes first, nothing is hidden behind it.
    const tiles = occasionTiles(CATALOGUE, inv({ wedding: 2, "birthday-party": 9, meeting: 2 }));
    expect(tiles.slice(0, 3).map((t) => t.slug)).toEqual(["birthday-party", "wedding", "meeting"]);
    expect(tiles.at(-1)!.venueCount).toBe(0);
  });

  it("reports a real count or zero, never an invented one", () => {
    const tiles = occasionTiles(CATALOGUE, inv({ wedding: 3 }));
    expect(tiles.find((t) => t.slug === "wedding")!.venueCount).toBe(3);
    expect(tiles.find((t) => t.slug === "meeting")!.venueCount).toBe(0);
    // The component renders the count only when it is above zero.
    const src = read("components/sections/OccasionDiscovery.tsx");
    expect(src).toContain("c.venueCount > 0 &&");
  });

  it("still honours an explicit limit where a caller wants one", () => {
    const many = Array.from({ length: 20 }, (_, i) => cat(`c-${i}`, `C${i}`, `c${i}s`, i));
    const counts = inv(Object.fromEntries(many.map((c) => [c.slug, 1])));
    expect(occasionTiles(many, counts)).toHaveLength(20);
    expect(occasionTiles(many, counts, 3)).toHaveLength(3);
  });

  it("keeps the SEO gate even though the UI gate is gone", () => {
    // The whole reason showing all 28 to PEOPLE is safe. If this ever stops
    // being true, the grid becomes 26 links into a doorway-page farm.
    const hub = read("app/venues/[category]/page.tsx");
    const sitemap = read("app/sitemap.ts");
    expect(hub).toContain("indexable: venueCount >= MIN_VENUES_FOR_CATEGORY_INDEX");
    expect(sitemap).toContain("if (!inv || inv.venueCount < MIN_VENUES_FOR_CATEGORY_INDEX) continue");
    // And an empty occasion page is a real destination, not a dead end.
    expect(hub).toContain("List your venue");
  });
});

describe("the category landing pages earn their place in the index", () => {
  const hub = read("app/venues/[category]/page.tsx");
  const cityPage = read("app/venues/[category]/[city]/page.tsx");
  const sitemap = read("app/sitemap.ts");

  it("does not collide with the venue route", () => {
    // /halls/[slug] is a VENUE. /halls/wedding would collide with any hall
    // whose slug happened to be "wedding".
    expect(fs.existsSync(path.join(ROOT, "app/venues/[category]/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "app/halls/[category]"))).toBe(false);
  });

  it("is indexable only with real inventory", () => {
    expect(hub).toContain("indexable: venueCount >= MIN_VENUES_FOR_CATEGORY_INDEX");
    expect(cityPage).toContain("indexable: venueCount >= MIN_VENUES_FOR_CATEGORY_INDEX");
  });

  it("hands weddings-by-city back to the page that already ranks", () => {
    // /wedding-halls/<city> exists, targets exactly this query, and is the
    // only page set on the site that ranks. A second page about the same
    // venues would compete with it.
    expect(cityPage).toContain("LEGACY_CITY_ROUTE_CATEGORIES");
    expect(cityPage).toContain("permanentRedirect");
    expect(cityPage).toContain("`/wedding-halls/${city}`");
  });

  it("never puts a redirect or an empty page in the sitemap", () => {
    expect(sitemap).toContain("if (!inv || inv.venueCount < MIN_VENUES_FOR_CATEGORY_INDEX) continue");
    expect(sitemap).toContain('if (c.slug === "wedding") continue');
    expect(sitemap).toContain("if (count < MIN_VENUES_FOR_CATEGORY_INDEX) continue");
  });

  it("decides indexability from a STRICT read", () => {
    // A swallowed error would empty the category half of the sitemap behind an
    // HTTP 200 — the exact shape lib/seo/cities.ts documents.
    expect(sitemap).toContain("fetchCategoryInventoryStrict()");
    expect(sitemap).toContain("fetchVenueCategoriesStrict()");
    expect(hub).toContain("fetchCategoryInventoryStrict()");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. THE READS ARE STRICT WHERE IT MATTERS
// ═════════════════════════════════════════════════════════════════════════════

describe("strict vs lenient catalogue reads", () => {
  it("uses the strict read on every form that SAVES", () => {
    // An empty picker caused by a failed read would let an owner publish — or
    // re-save — a hall with no categories at all, invisible in every typed
    // view, for a reason they were never shown.
    for (const rel of [
      "app/owner/(dashboard)/halls/new/page.tsx",
      "app/owner/(dashboard)/halls/[id]/edit/page.tsx",
      "app/admin/hall-drafts/page.tsx",
    ]) {
      expect(read(rel), rel).toContain("fetchVenueCategoriesStrict");
    }
  });

  it("uses the lenient read on surfaces that can honestly render nothing", () => {
    for (const rel of ["app/page.tsx", "app/halls/page.tsx", "app/halls/[slug]/page.tsx"]) {
      expect(read(rel), rel).toContain("fetchVenueCategories(");
      expect(read(rel), rel).not.toContain("fetchVenueCategoriesStrict");
    }
  });

  it("refuses to hand the admin screen a silent empty list", () => {
    const server = read("lib/venue-categories.server.ts");
    expect(server).toContain("admin read failed");
    expect(server).toContain("hall usage read failed");
    // The session client, or RLS hides the inactive half from the admin.
    expect(server).toContain("getSupabaseServerClient");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. "NOT RECORDED" SURVIVES
// ═════════════════════════════════════════════════════════════════════════════

describe("the unrecorded-occasion bucket", () => {
  it("is rendered, labelled and counted, not dropped", () => {
    const panel = read("components/venues/EventTypeBreakdown.tsx");
    expect(panel).toContain("Not recorded");
    // And the panel states its own coverage, so three neat bars off fifty
    // bookings cannot read as the whole picture.
    expect(panel).toContain("recorded an occasion");
  });

  it("is never defaulted into a real occasion on the way in", () => {
    const flow = read("app/book/[slug]/_components/BookingFlow.tsx");
    // The old default was the literal string "Wedding", which is plainly wrong
    // on a conference hall and was written into every booking's notes.
    expect(flow).not.toContain('useState<string>("Wedding")');
    expect(flow).toContain('eventOptions[0]?.slug ?? ""');
  });

  it("cannot break a payment when the column is missing", () => {
    // The booking insert is a four-rung fallback ladder that REFUSES a coupon
    // booking outright when any column comes back unknown. event_type is
    // stamped after the insert instead, so the deploy window before 0102 is
    // applied cannot take real payments down over a metadata field.
    const actions = read("app/book/[slug]/actions.ts");
    const insertIdx = actions.indexOf('.insert({ ...basePayload');
    const stampIdx = actions.indexOf('.update({ event_type: v.eventType })');
    expect(insertIdx).toBeGreaterThan(0);
    expect(stampIdx).toBeGreaterThan(insertIdx);
    expect(actions).not.toContain("event_type: v.eventType,\n    ...breakdownPayload");
  });
});
