# Hallnect — Seed Data (Tamil Nadu)

Hallnect currently serves **Tamil Nadu only**. The seed is a single clean example hall.

| File | What it does |
|---|---|
| [`seed_clean_hallnect_demo.sql`](./seed_clean_hallnect_demo.sql) | **Primary seed.** Deletes the old multi-city demo halls, ensures the amenity catalogue, and upserts ONE example hall — **Grand Lotus Mahal** (Madurai · Thirunagar, approved) — with amenities, a cover image, and a few availability rows. |
| [`reset_demo_data.sql`](./reset_demo_data.sql) | Removes the **old** 12-hall demo set + its demo users/owner (deterministic UUID prefixes only; real user data untouched). Optional — the primary seed already deletes the old demo halls by slug. |

> The previous `demo_data.sql` (12 halls across 6 South-Indian cities, incl. out-of-Tamil-Nadu Bangalore/Hyderabad/Kochi) has been **removed** — it contradicted the Tamil-Nadu-only + single-example-hall policy.

## The example hall
**Grand Lotus Mahal** (`grand-lotus-mahal`) — Madurai, Thirunagar, 300–800 guests, ₹85,000 base, status `approved`. Amenities: AC, Parking, Dining Hall, Stage, Bride Room, Groom Room, Generator Backup, CCTV, Sound System, Kitchen. Cover image: `public/images/example-hall.svg` (local placeholder — replace with a real upload later).

## How to run
1. Supabase → **SQL Editor** → **New query**.
2. Paste the contents of `seed_clean_hallnect_demo.sql` → **Run**.
3. It needs at least one `hall_owners` row to attach to. If you have none, register an owner and admin-approve them first, then run.
4. Verify:
   ```sql
   select slug, name, city, status from public.halls where slug = 'grand-lotus-mahal';
   select count(*) from public.halls where status = 'approved'; -- 1
   ```

It is **idempotent** — re-running is safe.

## Reset
```sql
delete from public.halls where slug = 'grand-lotus-mahal';
-- cascades to hall_images / hall_amenities / availability.
```

## Notes
- Runs as `postgres` in the SQL Editor, so the escalation-guard triggers accept it via `is_trusted_backend()`.
- The example image is an original SVG placeholder (not copyrighted). Replace via the owner dashboard image upload, or swap `hall_images.url` for a Supabase Storage URL.
- `rating_average` / `rating_count` start at 0 (no seeded reviews) and update via the `recalc_hall_rating` trigger when real reviews are added.
- **Adding real halls:** owners register → admin approves owner → owner adds a hall → admin approves the hall. Approved halls appear in search + on the homepage automatically.
