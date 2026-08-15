# Vercel "Internal Server Error" — Diagnosis & Fix

**Date:** 2026-06-26
**Symptom:** Hallnect returns HTTP 500 on **every** route after deploying to Vercel, while working locally.

---

## Root cause

**Missing / misconfigured environment variables on Vercel**, combined with two code paths that turned a single bad/absent env var into a **site-wide** 500 instead of a contained failure.

Why it works locally but not on Vercel: locally the values come from `.env.local`. On Vercel they must be set in the project's Environment Variables. Critically, **`NEXT_PUBLIC_*` variables are inlined at *build* time** — if they weren't present when Vercel built the app, they are `undefined` in the deployed bundle (and stay that way until a **rebuild/redeploy**).

### The two amplifiers (every-route 500)

1. **`proxy.ts`** (the Next 16 middleware) runs on **every** request via its matcher. It did:
   ```ts
   createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, …)
   await supabase.auth.getUser();
   ```
   With the `!` non-null assertions, missing Supabase env → `createServerClient(undefined, undefined, …)` **throws**. No try/catch → the middleware errors on **every request, including otherwise-static pages** → 500 everywhere. This is the single most likely culprit, because it sits in front of literally every route.

2. **`app/layout.tsx` → `resolveAppUrl()`** computes `metadataBase` from `NEXT_PUBLIC_APP_URL`. It **threw** on a malformed value (a common deploy mistake is `myapp.vercel.app` with no `https://`). The root layout renders on every page → a throw here also 500s the whole site.

Secondary (NOT every-route) contributors that were checked and are already safe:
- `lib/supabase/admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`) is a **lazy** singleton — only throws when first used (webhook / owner-OAuth upgrade), not on every route.
- `lib/cashfree.ts` (`CASHFREE_*`) is gated by `isCashfreeConfigured()` which **doesn't throw** — missing Cashfree env degrades to "payments unavailable", not a 500.
- No `instrumentation.ts` exists, so `validateEnv()` is **not** called at startup (no boot-time crash).

---

## Fixes (3 files — no app logic, payment, DB, RLS, or security changes)

### 1. `proxy.ts` — fail-open + guard
- If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing → **skip** the session refresh, log a safe one-line warning (KEY NAME only, never a value), and return `NextResponse.next()`.
- Wrapped `createServerClient` + `auth.getUser()` in `try/catch` so a transient auth/network error can never 500 every route.
- **Why this is safe:** the proxy only *refreshes* the session — it does **not** protect routes. Route protection happens server-side in layouts via `requireRole()` (unchanged). Failing open here does **not** bypass auth or RLS; it just means "session not refreshed this request."

### 2. `app/layout.tsx` — `resolveAppUrl` never throws
- Empty/missing → safe localhost fallback.
- Scheme-less value (e.g. `myapp.vercel.app`) → auto-prefixed with `https://`.
- Invalid → log (the value is a public URL, not a secret) and fall back, instead of throwing. `metadataBase` is cosmetic (OG/canonical URLs) and must never crash the root layout.

### 3. `lib/env.ts` — production-safe `requireEnv`
- Error guidance is now environment-aware: in production it says "set it in your host's env vars and redeploy" (and notes that `NEXT_PUBLIC_*` requires a rebuild), instead of the dev-only "edit .env.local / restart dev server".
- **Still prints only the KEY NAME, never a value** — safe for server logs.

**Verified:** `npm run lint` → 0 errors · `npm run type-check` → clean · `npm run build` → exit 0.

---

## Required Vercel environment variables

Set ALL of these in **Vercel → Project → Settings → Environment Variables** (Production + Preview). Copy the values from your local `.env.local`. **Never commit them.**

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | **Required** — proxy + every server client. Missing → 500 everywhere. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | **Required** — same. Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Webhook + owner-OAuth role upgrade. Do **not** prefix `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_APP_URL` | Public | Must be a full URL **with scheme**: `https://<your-domain>`. Used for OAuth + Cashfree return/notify URLs + metadataBase. |
| `CASHFREE_APP_ID` | Server-only | Payments. |
| `CASHFREE_SECRET_KEY` | **Server-only** | Payments. Never exposed to client. |
| `CASHFREE_ENV` | Server-only | `sandbox` or `production`. |
| `NEXT_PUBLIC_CASHFREE_ENV` | Public | Client SDK mode toggle. |

> Reminder: `NEXT_PUBLIC_*` are baked in at **build** time. After setting/changing them you **must redeploy** (rebuild) — saving the var alone does nothing for the running deployment.

---

## Redeploy steps

1. Vercel → your project → **Settings → Environment Variables** → add every row above for **Production** (and Preview if you use preview deploys). Make sure `NEXT_PUBLIC_APP_URL` includes `https://`.
2. **Deployments** tab → latest deployment → **⋯ → Redeploy** → **uncheck "Use existing build cache"** (forces `NEXT_PUBLIC_*` to be re-inlined).
3. After it goes live:
   - Supabase → Auth → **URL Configuration**: Site URL + add `https://<domain>/auth/callback` to redirect allow-list.
   - Cashfree dashboard: set `notify_url` = `https://<domain>/api/webhooks/cashfree`, and allow the domain for `return_url`.

---

## How to test after redeploy

- [ ] `https://<domain>/` and `/halls` load (200), no 500.
- [ ] `/terms` (static legal page) loads — confirms the proxy no longer crashes the request pipeline.
- [ ] If you intentionally leave a Supabase var unset, the site still serves pages and the Vercel **Function Logs** show `[proxy] Supabase env missing …` (graceful, not a blanket 500).
- [ ] Vercel → Deployment → **Functions / Logs**: no unhandled middleware exceptions.
- [ ] Sign in works (session refresh active when env is present).
- [ ] No secrets appear in client bundle or browser console; user-facing errors are generic.

If a 500 persists after setting all vars + a cache-free redeploy, open **Vercel → Deployment → Functions logs** and read the actual error/digest — the logging added here makes the missing-var case explicit.
