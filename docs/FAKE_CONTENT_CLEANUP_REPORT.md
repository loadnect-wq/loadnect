# Hallnect — Fake Content Cleanup Report

**Date:** 2026-06-28

## Fake stats / trust numbers removed
| Where | Was | Now |
|---|---|---|
| Homepage hero trust strip (`app/page.tsx`) | "2,400+ Verified venues", "50,000+ Couples served", "4.8★ Average rating" | Honest items: **Launching in Tamil Nadu**, **Verified listings only**, **Secure booking flow**, **Owner-approved venues** |
| Homepage owner CTA (`app/page.tsx`) | "Reach 50,000+ couples planning their wedding" | "List your wedding hall on Hallnect" |
| Signup subtitle (`app/(auth)/signup/page.tsx`) | "Join thousands of couples finding their perfect venue" | "Find and book your perfect venue in Tamil Nadu" |
| Premium page hero + metadata (`app/premium/page.tsx`) | "seen by thousands of couples searching every day" | "couples searching in Tamil Nadu find your venue first" |
| App description (`lib/constants.ts`) | "trusted by couples and event planners" | "secure booking, owner-approved listings" |
| Footer description (`components/layout/Footer.tsx`) | "trusted by couples and event planners" | "secure booking, owner-approved listings" |

The `TrustStat` component (big fabricated number + label) was replaced with `TrustItem` (checkmark + honest claim). **No new fake numbers were introduced.**

## Fake demo data removed (this + prior pass)
- `MOCK_HALLS` array emptied (`lib/mock-data.ts`) — removed ~12 fabricated halls.
- Old multi-city demo seed `supabase/seeds/demo_data.sql` deleted (12 halls, incl. out-of-Tamil-Nadu).
- Homepage now renders **real approved halls from Supabase** (or a clean empty state), never fake cards.
- Fabricated city "venue counts" removed from homepage city tiles.
- Testimonials de-numbered and re-localized to Tamil Nadu (no fake metro claims).

## Replaced sections
- Hero trust strip → honest launch-stage messaging.
- "Pan-India Coverage" → "Tamil Nadu Coverage".
- Pricing plans → real Free/Pro/Elite (see `PRICING_UPDATE_REPORT.md`).

## Verification
Repo grep (excluding docs) for `2,400`, `50,000 couples`, `average rating`, `trusted by`, `Starter`, `2,999`, `5,999`, `trial` → **no user-facing matches** (only legitimate pricing numbers like `50000`/`150000` and cleanup-SQL comments remain). Runtime: homepage shows "Launching in Tamil Nadu"; no `2,400`/`Average rating`.
