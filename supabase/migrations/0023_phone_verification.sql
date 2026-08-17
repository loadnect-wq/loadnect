-- ─────────────────────────────────────────────────────────────────────────────
-- 0023_phone_verification.sql
-- Phone-verification state for Twilio Verify OTP (scaffolded; credentials are
-- configured later via env vars — see .env.example).
--
-- profiles.phone already exists (0002). These columns record VERIFICATION
-- state only. Verification never grants or changes a role: profiles_update RLS
-- restricts writes to the caller's own row and prevent_role_change (0006) keeps
-- the role column locked regardless.
--
-- Additive + idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists phone_verified    boolean not null default false,
  add column if not exists phone_verified_at timestamptz;
