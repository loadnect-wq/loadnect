# Hallnect — Vercel Deployment Guide

**Date:** 2026-06-26. Pairs with `docs/VERCEL_500_FIX_REPORT.md` (root-cause of the prior 500) and `DEPLOYMENT_GUIDE.md` (full Supabase + Cashfree setup).

---

## Required environment variables

Set ALL in **Vercel → Project → Settings → Environment Variables** (Production + Preview). Copy values from your local `.env.local`. **Never commit them.**

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Public | **Full URL with scheme**: `https://<your-domain>`. A scheme-less value is now tolerated, but set it correctly. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | **Required** — without it the proxy + every server client fail. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | **Required**. Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Webhook + owner-OAuth role upgrade. Do NOT prefix `NEXT_PUBLIC_`. |
| `CASHFREE_APP_ID` | Server-only | Payments. |
| `CASHFREE_SECRET_KEY` | **Server-only** | Never exposed to client. |
| `CASHFREE_ENV` | Server-only | `sandbox` or `production`. |
| `NEXT_PUBLIC_CASHFREE_ENV` | Public | Client SDK mode toggle. |

> ⚠️ `NEXT_PUBLIC_*` are inlined at **build** time. After adding/changing them you MUST **redeploy without build cache** — saving the var alone does nothing for the running deployment.

---

## Why the previous deploy showed "Internal Server Error / URL and Key are required"
Missing `NEXT_PUBLIC_SUPABASE_*`, surfaced by:
1. `proxy.ts` (runs on every request) calling `createServerClient(URL!, ANON!)` with no guard → threw on every route.
2. `app/layout.tsx` `resolveAppUrl` throwing on a malformed `NEXT_PUBLIC_APP_URL`.

Both are now hardened to fail gracefully + log clearly (see `docs/VERCEL_500_FIX_REPORT.md`). **But the app still needs the env vars set to function** — the hardening prevents a blanket 500, it does not replace the values.

---

## Deploy steps
1. Push the repo (see the repo's README/Git remote).
2. Vercel → **Add New → Project → Import** the repo. Framework auto-detects Next.js.
3. Add every env var above (Production + Preview). Verify `NEXT_PUBLIC_APP_URL` has `https://`.
4. Deploy.
5. Post-deploy wiring:
   - **Supabase → Auth → URL Configuration:** Site URL = `https://<domain>`; add `https://<domain>/auth/callback` to redirect allow-list.
   - **Cashfree dashboard:** `notify_url = https://<domain>/api/webhooks/cashfree`; allow `<domain>` for `return_url`.
6. If you changed env vars after the first build: **Deployments → ⋯ → Redeploy → uncheck "Use existing build cache."**

---

## Post-deploy smoke test
- [ ] `/`, `/halls`, a hall detail, `/terms` load (200, no 500).
- [ ] Vercel → Deployment → **Functions/Logs**: no unhandled middleware exception. If a Supabase var is missing you'll see an explicit `[proxy] Supabase env missing …` (graceful), not a blanket 500.
- [ ] Sign in works (session refresh active).
- [ ] No secrets in the client bundle or browser console.
- [ ] Then run `docs/CASHFREE_TESTING_GUIDE.md` and `docs/SUPABASE_RLS_TESTING_GUIDE.md`.

## Rollback
- Vercel keeps prior deployments — use **Instant Rollback**.
- Keep `CASHFREE_ENV=sandbox` until the production payment path is confirmed, so a bad deploy can't take live payments.
