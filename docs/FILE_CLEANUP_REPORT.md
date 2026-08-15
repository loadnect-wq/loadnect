# Hallnect — File Cleanup Report

**Date:** 2026-06-26

## Files deleted
| File | Why | Safety check |
|---|---|---|
| `app/_components/FeaturedCarousel.tsx` | Mock-only homepage carousel; orphaned after the homepage switched to real DB halls | Grepped: no remaining imports (only a doc mention). Build passes after deletion. |

## Files changed (not deleted)
| File | Change |
|---|---|
| `app/page.tsx` | Homepage now async + DB-driven featured halls (`fetchHalls`); empty state; removed mock featured + recently-viewed; removed `mockHallToListing` helper |
| `lib/constants.ts` | Removed 7 dead nav/footer links; `FOOTER_LINKS.company` → `explore`, all hrefs now real |
| `components/layout/Footer.tsx` | Updated to `FOOTER_LINKS.explore` + "Explore" heading |
| `app/_components/RecentlyViewed.tsx` | Slimmed to only `recordRecentlyViewed()` (still used by hall detail); removed the unused mock-backed display component |
| `supabase/seed_example_hall.sql` | **New** — single example hall (Grand Lotus Mahal) |

## Files intentionally KEPT (not deleted)
- `lib/mock-data.ts` — still exports real utilities (`formatPrice`, `CITIES`, `CAPACITY_OPTIONS`, `CARD_GRADIENTS`) used across the app; `MOCK_HALLS` array still referenced by the legacy `/saved` page. See `DATA_CLEANUP_REPORT.md`.
- `app/saved/`, `app/bookings/`, `app/profile/` — legacy guest pages; reachable from the mobile bottom nav (no 404). Consolidation recommended but deferred.
- All `supabase/migrations/*`, `supabase/ALL_MIGRATIONS.sql`, config files, `.env.example`, required docs, API/webhook routes, Supabase client files — required.

## Cleanup verification
- `git grep` confirmed deleted/slimmed files have no remaining importers (except the kept `recordRecentlyViewed`).
- `tsc --noEmit` clean · `eslint .` 0 errors · `next build` exit 0 after changes.
- No backup/scratch/temp/debug files were found in the tracked tree (consistent with the earlier `CLEANUP_REPORT.md`).

## Risks
- **Low.** The only deletion (FeaturedCarousel) was verified orphaned. The `RecentlyViewed` slim-down preserved the one export still in use (`recordRecentlyViewed`), confirmed by build + type-check.
