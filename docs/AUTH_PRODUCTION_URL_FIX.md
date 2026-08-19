# Auth Production URL Fix — `requested path is invalid`

> **HISTORICAL (2026-08-15).** The production domain has since moved to **https://www.hallnect.com** (2026-08-19); `hallnect5.vercel.app` was released and no longer serves the app. URLs below are kept as a record of the original incident — do not copy them into configuration.

**Date:** 2026-08-15 · Production URL: **https://hallnect5.vercel.app**

## Symptom
During Supabase authentication the browser was sent to a malformed URL:

```
https://<supabase-project>.supabase.co/hallnect5.vercel.app/?code=...
```

and Supabase returned `{"error":"requested path is invalid"}`.

## Root cause — a Supabase dashboard setting, not app code
The redirect target was configured **without a scheme** (`hallnect5.vercel.app`
instead of `https://hallnect5.vercel.app`).

A scheme-less string is **not an absolute URL**. Supabase resolves it *relative to
its own origin*, which concatenates into
`https://<project>.supabase.co/hallnect5.vercel.app/…`.

Two details confirm the source was the **Supabase Site URL**, not this codebase:

1. The broken URL lands on `/` (`…vercel.app/?code=`). Every `redirectTo` in this
   app hardcodes `/auth/callback`, so an app-generated URL would have contained
   that path.
2. All auth call sites build the origin from `window.location.origin`, which is
   always absolute:
   - `app/(auth)/login/page.tsx` — Google OAuth
   - `app/(auth)/signup/page.tsx` — `emailRedirectTo` + OAuth
   - `app/owner/register/page.tsx` — owner signup + OAuth
   - `app/auth/callback/route.ts` — uses `new URL(request.url).origin`

So no application code could emit that URL.

## Required configuration (do this — it is the actual fix)

### 1. Supabase Dashboard → Authentication → URL Configuration
| Field | Value |
|---|---|
| **Site URL** | `https://hallnect5.vercel.app` |
| **Redirect URLs** | `https://hallnect5.vercel.app/auth/callback` |
| **Redirect URLs** (keep for dev) | `http://localhost:3000/auth/callback` |

Include `https://` on every entry. No trailing slash on the Site URL.

### 2. Vercel → Project → Settings → Environment Variables
```
NEXT_PUBLIC_APP_URL=https://hallnect5.vercel.app
```
`NEXT_PUBLIC_*` values are inlined at build time — **redeploy after changing it**
(without build cache).

> There is no `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_VERCEL_URL` in this project.
> `NEXT_PUBLIC_APP_URL` is the single app-origin variable — do not add duplicates.

## Code hardening shipped with this fix
Auth never read `NEXT_PUBLIC_APP_URL`, but **Cashfree `return_url` did** — so the
same scheme-less value would have produced a broken payment return URL later.
Fixed at the source:

- **`lib/env.ts` → `getAppUrl()`** (new): trims, adds `https://` when the scheme
  is missing, rejects non-http(s), strips the trailing slash, falls back to
  `http://localhost:3000`, and never throws.
- **`lib/payments.ts`**: Cashfree `return_url` / `notify_url` now use it.
- **`app/layout.tsx`**: `metadataBase` now uses it (removed the duplicated local
  `resolveAppUrl`, so there is one source of truth).

Verified against the exact bad input:

| `NEXT_PUBLIC_APP_URL` | Resulting callback |
|---|---|
| `hallnect5.vercel.app` | `https://hallnect5.vercel.app/auth/callback` ✅ |
| `https://hallnect5.vercel.app/` | `https://hallnect5.vercel.app/auth/callback` ✅ |
| `not a url` / empty | `http://localhost:3000/auth/callback` (safe fallback) ✅ |
| `javascript:alert(1)` | falls back — non-http(s) rejected ✅ |

## Security posture (unchanged, re-verified)
- **Open redirect blocked**: `safeNext()` in `app/auth/callback/route.ts` rejects
  `//evil.com`, `/\evil.com`, `@evil.com`, `.evil.com` and absolute URLs, then
  restricts to an allow-list (`/auth/redirect`).
- **Invalid/expired code**: `exchangeCodeForSession` failure → redirect to
  `/login?error=oauth_failed`. Missing code → same. No crash, no detail leak.
- **Role elevation** only ever `customer → owner_pending`, only after a
  successful code exchange (CSRF-safe), idempotent.
- Redirects are built from the **request origin**, never from user input.
- No service-role or Cashfree secret is exposed; RLS untouched.

## Manual verification after configuring
1. Open `https://hallnect5.vercel.app/login` → "Continue with Google".
2. Confirm the URL bar shows `accounts.google.com`, then returns to
   `https://hallnect5.vercel.app/auth/callback?code=…`.
3. Confirm **no** URL contains `.supabase.co/hallnect5.vercel.app`.
4. Repeat for signup (email confirmation link) and owner registration.
5. Check logout, refresh (session persists), and a protected route while logged
   out (should redirect to `/login`).
