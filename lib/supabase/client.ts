// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/client.ts — Browser-side Supabase client.
//
// USE IN:  Client Components ("use client"), browser hooks
// DO NOT USE IN:  Server Components, Route Handlers, Server Actions
//   → For server-side access use lib/supabase/server.ts
//   → For admin/service-role access use lib/supabase/admin.ts
//
// This module creates a singleton browser client.  Calling getSupabaseClient()
// multiple times returns the same instance, which is important for keeping
// auth state consistent across the page.
// ─────────────────────────────────────────────────────────────────────────────

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let _client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Returns the singleton Supabase browser client.
 * Safe to call from any Client Component or hook.
 */
export function getSupabaseClient() {
  if (_client) return _client;

  _client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // The session and the PKCE code_verifier live in these cookies — the most
      // sensitive values the browser holds. They were being written without
      // Secure, so a single plaintext request to the domain could disclose
      // them, while the far less sensitive hn_auth_next cookie already set it.
      // Only mark Secure over HTTPS so local http://localhost dev still works.
      cookieOptions: {
        secure: typeof window !== "undefined" && window.location.protocol === "https:",
        sameSite: "lax",
        path: "/",
      },
    }
  );

  return _client;
}
