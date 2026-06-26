-- ─────────────────────────────────────────────────────────────────────────────
-- 0008_seed_amenities.sql
-- Optional: seed the global amenities catalogue. Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.amenities (name, slug, icon, category) values
  ('Air Conditioning', 'air-conditioning', 'snowflake',   'comfort'),
  ('Valet Parking',    'valet-parking',    'car',         'parking'),
  ('Free Parking',     'free-parking',     'parking',     'parking'),
  ('In-house Catering','in-house-catering','utensils',    'food'),
  ('DJ & Music',       'dj-music',         'music',       'entertainment'),
  ('Outdoor Garden',   'outdoor-garden',   'trees',       'space'),
  ('Bridal Suite',     'bridal-suite',     'bed',         'space'),
  ('Swimming Pool',    'swimming-pool',    'waves',       'space'),
  ('Generator Backup', 'generator-backup', 'zap',         'utility'),
  ('In-house Decor',   'in-house-decor',   'sparkles',    'services'),
  ('AV / Stage Setup', 'av-stage-setup',   'projector',   'entertainment'),
  ('Wheelchair Access','wheelchair-access','accessibility','accessibility')
on conflict (slug) do nothing;
