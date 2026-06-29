# Hallnect — Mobile Responsiveness Checklist

**Date:** 2026-06-29

## Tested this pass
| Width | Method |
|---|---|
| 390px | Live preview screenshots (home, listing, login) |
| Build | `next build` exit 0 (responsive Tailwind classes compile) |

> Other widths (360/430/768/1024) share the same Tailwind responsive structure; the `lg:` breakpoint (1024px) is the mobile↔desktop switch. They were not each screenshot-verified this pass — see "remaining manual tests".

## Pages visually checked (390px)
- [x] `/` — app-style home, no overflow, bottom nav present, empty state intentional
- [x] `/halls` — sticky search, filter chips scroll, empty state clean
- [x] `/login` — centered card, large inputs/buttons, bottom nav correctly hidden

## Pages NOT screenshot-verified (auth-gated — no test session here)
- [ ] `/customer/dashboard`, `/customer/bookings`, `/customer/saved-halls`, `/customer/profile`
- [ ] `/owner/dashboard`, `/owner/halls`, `/owner/halls/new`, `/owner/bookings`, `/owner/revenue`
- [ ] `/admin/dashboard`, `/admin/users`, `/admin/owners`, `/admin/halls`, `/admin/bookings`, `/admin/payments`, `/admin/commissions`
- [ ] `/halls/grand-lotus-mahal` (needs the demo-hall seed applied)
- [ ] `/book/[slug]` flow (needs auth + seeded hall)

## Issues fixed this pass
- Bottom nav: added `aria-current="page"` (screen-reader active state) + `active:scale-95` tap feedback with `motion-reduce` fallback.
- No overflow / overlap / broken-card issues found on the audited public pages.

## Known-good (from prior passes, structural)
- Bottom nav fixed, glass/blur, safe-area padding (`pb-[env(safe-area-inset-bottom)]`); hidden on auth/checkout routes.
- Content has bottom padding so the nav never overlaps (`pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))]` in the root layout).
- Sticky booking CTA uses its own bottom padding; booking flow has a progress bar.
- Cards are `rounded-2xl`+ with soft shadows; horizontal scroll uses `.no-scrollbar`.

## Remaining manual tests (recommended before public launch)
1. Log in as customer / owner_approved / admin on a real phone (or DevTools 360/390/430px) and walk each dashboard:
   - No horizontal overflow; admin lists read as cards, not cramped tables.
   - Tap targets ≥ 44px; sticky buttons don't cover content.
2. Run `supabase/seeds/seed_clean_hallnect_demo.sql`, then check `/halls/grand-lotus-mahal`:
   - Image carousel, amenity grid, sticky "Book Now" bar, no overlap.
3. Walk the booking flow on mobile (manual mode): date → slot → details → summary → Submit Booking Request → done.
4. 768px (tablet): confirm it still uses the mobile app shell intentionally (desktop layout starts at `lg`/1024px).
5. Error/404 pages and loading skeletons at 390px.

## Desktop safety
The only code change is inside the `lg:hidden` bottom nav, so desktop (≥1024px) is unchanged. Verified: `eslint` 0 errors, `tsc` clean, `next build` exit 0.
