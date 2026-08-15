// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/admin.ts — Service-role Supabase client.
//
// ⛔  WARNING — THIS FILE IS SERVER-ONLY.
//    The service-role key bypasses Row Level Security (RLS) entirely.
//    Any query made through this client runs with full database access.
//
// RULES (strictly enforced by the "server-only" package below):
//   1. NEVER import this file in Client Components ("use client" files).
//   2. NEVER import this file in browser hooks (hooks/use-*.ts).
//   3. NEVER pass the admin client — or any of its query results that
//      contain sensitive data — as a prop to a Client Component.
//   4. Only use this client for trusted server operations:
//        - Admin Route Handlers  (app/api/admin/**)
//        - Background jobs / cron functions
//        - Webhook receivers
//        - One-off seed/migration scripts
//   5. Always scope queries to the minimum required data.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only"; // Build-time error if imported in a client bundle

import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/types/database";

function createAdminClient() {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        // Service-role clients must not persist or refresh sessions.
        autoRefreshToken: false,
        persistSession:   false,
      },
    }
  );
}

// Lazy singleton — created on first call, not at module import time.
// This avoids validation errors at build time when env vars are not yet set.
let _adminClient: ReturnType<typeof createAdminClient> | undefined;

/**
 * Returns the singleton Supabase admin (service-role) client.
 * Bypasses RLS — use with caution in trusted server contexts only.
 */
export function getSupabaseAdminClient() {
  if (!_adminClient) {
    _adminClient = createAdminClient();
  }
  return _adminClient;
}
