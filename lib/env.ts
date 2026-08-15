// ─────────────────────────────────────────────────────────────────────────────
// lib/env.ts — Environment variable helpers for Hallnect.
//
// USAGE RULES:
//   • Import this file ONLY from server-side code:
//       - Server Components (no "use client" directive)
//       - Route Handlers  (app/api/**/route.ts)
//       - Server Actions  ("use server" functions)
//       - lib/supabase/server.ts and lib/supabase/admin.ts
//
//   • Do NOT import this file in:
//       - Client Components ("use client" files)
//       - hooks/  (unless the hook is server-only)
//       - lib/supabase/client.ts
//
// WHY: SUPABASE_SERVICE_ROLE_KEY is stripped from the client bundle by
// Next.js (no NEXT_PUBLIC_ prefix), but the validation in requireEnv()
// would still throw in the browser if this file were imported client-side.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a required environment variable.
 * Throws with a clear, actionable message if the variable is missing or empty.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (typeof value !== "string" || value.trim() === "") {
    // SECURITY: only the KEY NAME is ever included — never a value — so this
    // message is safe to appear in server logs. Guidance is environment-aware:
    // in production the fix is to set the var in the host (e.g. Vercel) and
    // redeploy, not to edit .env.local.
    const guidance =
      process.env.NODE_ENV === "production"
        ? `Set "${key}" in your hosting provider's Environment Variables, then redeploy. ` +
          `(NEXT_PUBLIC_* vars are baked in at build time, so a rebuild/redeploy is required.)`
        : `1. Copy .env.example to .env.local  2. Fill in "${key}"  3. Restart the dev server (npm run dev).`;
    throw new Error(`Missing required environment variable "${key}". ${guidance}`);
  }
  return value.trim();
}

/**
 * Reads an optional environment variable with a fallback.
 */
export function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * Returns the application's public origin as a VALID ABSOLUTE URL with no
 * trailing slash — e.g. "https://hallnect5.vercel.app".
 *
 * WHY THIS EXISTS (production incident): a scheme-less value such as
 * "hallnect5.vercel.app" is not an absolute URL. Anything that hands it to a
 * third party as a redirect target (Supabase auth `redirectTo`, a Cashfree
 * `return_url`) will have it resolved RELATIVE to that third party's own
 * origin, producing broken URLs like
 * "https://<project>.supabase.co/hallnect5.vercel.app/?code=...".
 *
 * So we normalise defensively:
 *   • trim whitespace
 *   • add "https://" when the scheme is missing (the common deploy mistake)
 *   • strip any trailing slash so callers can safely append "/path"
 *   • fall back to localhost if the value is unusable, and never throw —
 *     this is called from the root layout, which renders on every page.
 */
export function getAppUrl(): string {
  const FALLBACK = "http://localhost:3000";
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (typeof raw !== "string" || raw.trim() === "") return FALLBACK;

  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    // Only http/https are meaningful as an app origin.
    if (url.protocol !== "http:" && url.protocol !== "https:") return FALLBACK;
    return url.origin; // origin drops any path/query and the trailing slash
  } catch {
    // The value is a public URL (not a secret), so it is safe to log.
    console.error(`[env] NEXT_PUBLIC_APP_URL is not a valid URL ("${raw}") — using fallback.`);
    return FALLBACK;
  }
}

/**
 * Validates ALL required environment variables at once.
 * Call this during app startup (e.g. in instrumentation.ts) to catch
 * missing variables before serving any requests.
 *
 * Example (app/instrumentation.ts):
 *   import { validateEnv } from "@/lib/env";
 *   export async function register() { validateEnv(); }
 */
export function validateEnv(): void {
  // ── Public (NEXT_PUBLIC_ — exposed to browser) ──────────────────────────
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // ── Server-only (never sent to the browser) ──────────────────────────────
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}
