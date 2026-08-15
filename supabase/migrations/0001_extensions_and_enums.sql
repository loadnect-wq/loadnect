-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_extensions_and_enums.sql
-- Extensions + all ENUM types for Hallnect.
-- Run this FIRST.
-- ─────────────────────────────────────────────────────────────────────────────

-- gen_random_uuid() lives in pgcrypto (bundled with Supabase).
create extension if not exists pgcrypto;

-- ── User roles ────────────────────────────────────────────────────────────────
-- NOTE: 'admin' is intentionally part of this enum but is NEVER assignable by a
-- normal user. Role escalation is blocked by RLS + the prevent_role_change trigger
-- (see 0006). New signups can only become 'customer' or 'owner_pending'.
do $$ begin
  create type user_role as enum (
    'customer',
    'owner_pending',
    'owner_approved',
    'admin'
  );
exception when duplicate_object then null; end $$;

-- ── Hall lifecycle ────────────────────────────────────────────────────────────
do $$ begin
  create type hall_status as enum (
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'suspended'
  );
exception when duplicate_object then null; end $$;

-- ── Booking lifecycle ─────────────────────────────────────────────────────────
do $$ begin
  create type booking_status as enum (
    'pending_payment',
    'payment_success',
    'booking_requested',
    'owner_confirmed',
    'owner_rejected',
    'cancelled',
    'completed',
    'refunded'
  );
exception when duplicate_object then null; end $$;

-- ── Availability calendar ─────────────────────────────────────────────────────
do $$ begin
  create type availability_status as enum (
    'available',
    'booked',
    'partially_booked',
    'blocked',
    'morning_booked',
    'evening_booked',
    'full_day_booked',
    'maintenance'
  );
exception when duplicate_object then null; end $$;

-- ── Payment lifecycle (Cashfree) ──────────────────────────────────────────────
do $$ begin
  create type payment_status as enum (
    'pending',
    'created',
    'payment_success',
    'payment_failed',
    'user_dropped',
    'cancelled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

-- ── Booking slot (used for double-booking prevention) ─────────────────────────
do $$ begin
  create type booking_slot as enum ('morning', 'evening', 'full_day');
exception when duplicate_object then null; end $$;

-- ── Support ticket lifecycle ──────────────────────────────────────────────────
do $$ begin
  create type ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
exception when duplicate_object then null; end $$;

-- ── Advertisement lifecycle ───────────────────────────────────────────────────
do $$ begin
  create type ad_status as enum ('pending', 'active', 'paused', 'expired', 'rejected');
exception when duplicate_object then null; end $$;

-- ── Commission lifecycle ──────────────────────────────────────────────────────
do $$ begin
  create type commission_status as enum ('pending', 'collected', 'paid_out', 'refunded');
exception when duplicate_object then null; end $$;
