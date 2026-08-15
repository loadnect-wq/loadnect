import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Supabase session-refresh proxy (Next.js 16 renamed "middleware" → "proxy").
// This runs on every request and ensures the user's auth token is kept fresh.
// Without this, server components will see a stale/expired session.
//
// This proxy does NOT protect routes — route protection is handled
// server-side in individual pages/layouts via getSupabaseServerClient().
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // PRODUCTION SAFETY: if the Supabase env is missing (e.g. not set in the
  // Vercel project, or NEXT_PUBLIC_* not present at build time), DO NOT crash
  // every route. This proxy only REFRESHES the session — it does not protect
  // routes (that is enforced server-side in layouts via requireRole). Failing
  // open here is therefore safe: the request continues without a refresh, the
  // misconfiguration is logged once for the operator, and visitors get a real
  // response instead of a blanket 500. We log only the missing KEY name — never
  // a value, so no secret can leak.
  if (!url || !anon) {
    console.error(
      "[proxy] Supabase env missing — skipping session refresh. Set " +
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the " +
      "deployment environment, then redeploy (NEXT_PUBLIC_* are baked in at build time)."
    );
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mirror updated cookies onto the request so downstream proxy logic
          // and the response both see the refreshed session.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // IMPORTANT: do not add code between createServerClient and auth.getUser().
    // A simple mistake could make it very hard to debug issues with users being
    // randomly logged out. Wrapped in try/catch so a transient auth/network
    // error never turns into a 500 for every route.
    await supabase.auth.getUser();
  } catch (e) {
    console.error("[proxy] session refresh failed:", e instanceof Error ? e.message : "unknown error");
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
