// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/public.ts — anon Supabase client with NO cookies.
//
// WHY THIS EXISTS: CACHING. Reading the request's cookies is what makes a route
// dynamic in the App Router, and every public page on this site was doing it —
// not to personalise anything, but because the catalogue queries happened to go
// through the session-aware client. The result was
// `Cache-Control: private, no-cache, no-store` and `X-Vercel-Cache: MISS` on
// every page, so each visitor paid for a full function invocation and a fresh
// round of queries to a database on another continent, to be shown exactly the
// same list of approved venues as the visitor before them.
//
// This client reads no cookies and carries no session, so a page whose data all
// comes from here can be rendered once and reused.
//
// SAFE BECAUSE THE DATA IS ALREADY PUBLIC. Every read routed through here is
// one an anonymous visitor could make anyway: approved halls, the city counts,
// active ads, the plan catalogue, the platform settings the booking form shows.
// RLS still applies — this is the `anon` role, exactly what a logged-out
// visitor already had — so it cannot widen what is visible. What it CANNOT do
// is see anything user-specific, which is the point: a cached page must not
// contain anything that differs per person.
//
// DO NOT USE for anything that depends on who is asking. The venue page's
// owner/admin preview of a not-yet-approved hall is the live example: it works
// precisely because RLS sees the caller's session, and it must keep using
// getSupabaseServerClient().
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let cached: SupabaseClient<Database> | null = null;

/**
 * A module-level singleton, which is only safe because there is no session on
 * it: nothing here is request-scoped, so there is nothing to leak between
 * requests. persistSession and autoRefreshToken are off for the same reason —
 * this client must never acquire per-user state.
 */
export function getSupabasePublicClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession:   false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return cached;
}
