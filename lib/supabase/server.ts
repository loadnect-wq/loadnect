// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/server.ts — Server-side Supabase client.
//
// USE IN:  Server Components, Route Handlers, Server Actions
// DO NOT USE IN:  Client Components or browser hooks
//   → For browser access use lib/supabase/client.ts
//   → For admin/service-role access use lib/supabase/admin.ts
//
// A new client is created per request (not a singleton) because it must read
// the request cookies to restore the user's auth session.  The cookie store
// from next/headers is request-scoped and cannot be shared across requests.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Creates a Supabase client scoped to the current request.
 * Must be called inside a Server Component, Route Handler, or Server Action.
 *
 * @example
 * // Server Component
 * const supabase = await getSupabaseServerClient();
 * const { data } = await supabase.from("halls").select("*");
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from a Server Component where cookies are
            // read-only.  This is safe to ignore — the Supabase middleware
            // (middleware.ts) is responsible for refreshing sessions.
          }
        },
      },
    }
  );
}
