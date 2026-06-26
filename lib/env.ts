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
    throw new Error(
      `\n\n⛔  Hallnect — Missing required environment variable\n` +
      `   "${key}" is not set or is empty.\n` +
      `   1. Copy .env.example to .env.local\n` +
      `   2. Fill in the value for "${key}"\n` +
      `   3. Restart the dev server (npm run dev)\n`
    );
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
