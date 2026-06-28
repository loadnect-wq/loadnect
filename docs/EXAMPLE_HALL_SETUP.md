# Hallnect — Example Hall Setup

**Date:** 2026-06-26

## The example hall
| Field | Value |
|---|---|
| Name | Grand Lotus Mahal |
| Slug | `grand-lotus-mahal` |
| City / Area | Madurai / Thirunagar |
| Address | Thirunagar, Madurai, Tamil Nadu, India (pincode 625006) |
| Capacity | 300–800 guests |
| Base price | ₹85,000 / day (morning ₹45,000, evening ₹50,000) |
| Advance | ₹10,000 (note: the booking flow computes advance as 25% of the slot price; this is the indicative advance) |
| Hall type | Wedding Hall (in description) |
| Status | `approved` (publicly visible) |
| Amenities | AC, Parking, Dining Hall, Stage, Bride Room, Groom Room, Generator Backup, CCTV, Sound System, Kitchen |

Description clearly states it is **sample/test data**, used to exercise search, image gallery, amenities, availability, booking, and payment.

## Image
- **Location:** `public/images/example-hall.svg` — an original branded SVG placeholder (not copyrighted).
- **Alt text:** "Grand Lotus Mahal wedding hall in Thirunagar, Madurai".
- The seed inserts a `hall_images` row with `url = '/images/example-hall.svg'`, `is_cover = true`.
- Both the hall **card** (`HallCard`) and **detail gallery** (`ImageGallery`) render via `next/image` with `unoptimized`, so the SVG displays correctly.
- To use a real photo: drop a `example-hall.jpg` in `public/images/` and change the seed `url`, **or** upload via the owner dashboard image manager (writes to the `hall-images` Supabase Storage bucket).

## How to run the seed
1. Supabase → **SQL Editor** → **New query**.
2. Paste `supabase/seeds/seed_clean_hallnect_demo.sql` → **Run**.
3. Requires at least one `hall_owners` row (it attaches the hall to the first owner). If none exists, register an owner via `/owner/register` and approve them in `/admin` first.
4. Verify:
   ```sql
   select slug, name, city, status from public.halls where slug = 'grand-lotus-mahal';
   select count(*) from public.halls where status = 'approved';  -- 1
   ```
5. Visit `/halls/grand-lotus-mahal` and search "Madurai" / "Grand Lotus Mahal".

> Until the seed is run, the connected DB has 0 approved halls and the homepage shows a clean empty state (no fake halls).

## How to add real halls later
Owner registers (`/owner/register`) → admin approves the owner (`/admin/owners`) → owner adds a hall (`/owner/halls/new`) with images, pricing, availability → admin approves the hall (`/admin/hall-approvals`). Approved halls automatically appear in search and on the homepage. The example hall does not block or interfere with real listings.

## Reset
```sql
delete from public.halls where slug = 'grand-lotus-mahal';
-- cascades to hall_images / hall_amenities / availability.
```
Re-running the seed recreates it (idempotent).
