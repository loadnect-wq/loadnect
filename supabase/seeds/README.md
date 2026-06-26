# Hallnect — Demo Seed Data

Two SQL files to populate the database with realistic demo halls for local testing and screenshots.

| File | What it does |
|---|---|
| [`demo_data.sql`](./demo_data.sql) | Inserts 1 demo owner + 3 demo customers, 12 approved halls across 6 South Indian cities, 4 images per hall, 6 amenities each, 5 availability rows per hall, and 3 reviews per hall. |
| [`reset_demo_data.sql`](./reset_demo_data.sql) | Removes everything the seed file created. Uses deterministic UUIDs so only demo rows are affected — real user data is untouched. |

## What's in the seed

**12 halls** (2 in each city):
- Chennai — Annai Pearl Mahal, Marina Grand Convention
- Coimbatore — Kovai Kalyana Mandapam, Saravana Banquet Centre
- Madurai — Meenakshi Heritage Mahal, Vaigai Sangam Convention
- Bangalore — Sapphire Garden Hall, Whitefield Royale Convention
- Hyderabad — Nizami Mehfil Banquet, Charminar Grand Convention
- Kochi — Backwater Pearl Convention, Periyar Banquet Palace

Each hall includes name, area, full address with pincode + lat/long, description, capacity range, base price per day, morning + evening slot pricing, hall type (in description), amenities, 4 images, availability examples, and 3 reviews.

> **Advance amount** is not stored on `halls` — it's computed at booking time (25% of the slot price, per the booking flow). To override per-hall, add an `advance_pct` column and update the booking step.

## How to insert the seed

### Option A — Supabase dashboard (easiest)
1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [`demo_data.sql`](./demo_data.sql).
3. Click **Run**. You should see `Success. No rows returned.` and a `commit` notice.
4. Verify the counts at the bottom of the file (12 halls, 48 images, etc.).

### Option B — psql / supabase CLI
```bash
# from the project root
psql "$DATABASE_URL" -f supabase/seeds/demo_data.sql

# or with the Supabase CLI on a linked project
supabase db execute --file supabase/seeds/demo_data.sql
```

### Option C — Re-run safely
The file is **idempotent** — every insert uses `on conflict do nothing` or `on conflict do update`. Run it twice and the second run is a no-op.

## How to reset the seed

Run [`reset_demo_data.sql`](./reset_demo_data.sql) the same way:
- SQL Editor → paste → Run, **or**
- `psql "$DATABASE_URL" -f supabase/seeds/reset_demo_data.sql`

The reset deletes only rows with the demo UUID prefixes (`de100000-…` for users, `11111111-…` for the owner, `aaaa0001-…` through `aaaa0006-…` for halls). It cascades cleanly:
- `delete halls` → cascades to `hall_images`, `hall_amenities`, `availability`, `reviews`
- `delete auth.users` → cascades to `profiles`

After reset, you can re-run `demo_data.sql` from scratch.

## Notes

- The script runs as `postgres` in the Supabase SQL editor, so the `prevent_role_change` / `prevent_owner_self_verify` / `prevent_hall_self_approve` triggers all accept it via `is_trusted_backend()`.
- Demo `auth.users` passwords are random bcrypt hashes — the accounts are **not login-able**. They exist only to give halls and reviews a valid FK target.
- Hall images use `picsum.photos` with a deterministic per-slug seed. These are CC0 Unsplash-backed photos — safe for demo use, not copyrighted. Once you upload real photos to your `hall-images` bucket, replace the URLs in `hall_images.url` with Supabase storage URLs (or just delete and re-upload via the owner dashboard).
- `halls.rating_average` and `halls.rating_count` are populated by the `recalc_hall_rating` trigger from the 3 reviews you insert per hall — typically lands around `4.7` with `3 reviews`.
