# Hallnect — Deployment Guide

Target stack: **Next.js 16 (App Router) → Vercel**, **Supabase** (Postgres + Auth + Storage), **Cashfree** (payments).

> Status note (2026-06-25): the project is **not yet a git repo and has never been deployed**. This guide takes you from the current local state to a working production deployment.

---

## 0. Prerequisites

- Node 20+, npm
- A Supabase project (production)
- A Cashfree merchant account (sandbox + production credentials)
- A Vercel account
- A domain (or use the Vercel-provided one)

Confirm the build is green locally first:
```bash
npm install
npx tsc --noEmit      # must be clean
npx next build        # must exit 0
```
(Both verified passing as of this audit.)

---

## 1. Supabase setup

### 1.1 Apply ALL migrations (in order)
The connected DB in development is currently **missing 0013–0016** — do not skip these.
```
supabase/migrations/0001 … 0016
```
Apply via the Supabase SQL editor (paste each file in order) or the Supabase CLI:
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
**Verify:** after applying, load `/halls` and confirm the server log no longer prints
`halls.premium_tier missing — run migration 0013`. If it still prints, 0013 didn't apply.

### 1.2 Storage
Migration `0010_storage.sql` creates the public `hall-images` bucket (5 MB, `image/jpeg,png,webp`) with RLS. Confirm the bucket exists in Storage after migration.

### 1.3 Auth configuration (Supabase dashboard → Authentication)
- **Site URL:** `https://<your-domain>`
- **Redirect URLs (allow list):** add `https://<your-domain>/auth/callback`
- Enable **Email** provider. Decide on email confirmation (the UI handles both on/off).
- Enable **Google** provider (used by login/signup/owner-register "Continue with Google"); set Google OAuth redirect to the Supabase callback per Supabase's Google guide.

### 1.4 Seed an admin
`admin` cannot be created from the UI. After a normal signup, promote one account directly:
```sql
update public.profiles set role = 'admin' where email = 'admin@yourdomain.com';
```

---

## 2. Cashfree setup

### 2.1 Sandbox first
- Get **sandbox** App ID + Secret Key from the Cashfree dashboard.
- Set `CASHFREE_ENV=sandbox`. The wrapper uses `https://sandbox.cashfree.com/pg`.

### 2.2 Webhook (notify_url)
- In the Cashfree dashboard, set the webhook URL to:
  `https://<your-domain>/api/webhooks/cashfree`
- Saving it triggers a `GET` probe — the endpoint returns 200 to validate.
- The app verifies `x-webhook-signature` (HMAC-SHA256) and **rejects unsigned events with 401**.
- **Local note:** Cashfree cannot reach `localhost`. To test locally, tunnel (e.g. ngrok) and use the tunnel URL as the notify_url. Otherwise test on the deployed environment. The `return_url` page also performs server-side verification, so bookings still confirm without the webhook in dev.

### 2.3 Production
- Swap to **production** App ID + Secret Key and set `CASHFREE_ENV=production` (base URL switches to `https://api.cashfree.com/pg`).
- Re-point the production webhook to the production domain.
- Whitelist the production domain for `return_url` in the Cashfree dashboard.

---

## 3. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production + Preview as needed). Never commit them.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public | `https://<your-domain>` — used for OAuth + Cashfree return/notify URLs |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | RLS-bypassing — **must NOT be exposed**; do not prefix `NEXT_PUBLIC_` |
| `CASHFREE_APP_ID` | server-only | |
| `CASHFREE_SECRET_KEY` | **server-only** | never exposed to client |
| `CASHFREE_ENV` | server-only | `sandbox` or `production` |
| `NEXT_PUBLIC_CASHFREE_ENV` | public | client SDK mode toggle |

> The app validates required vars via `lib/env.ts` (`requireEnv`). A missing var throws a clear server-side error — but only server-side; it is never surfaced to the browser.

---

## 4. Deploy to Vercel

```bash
# from the project root
git init
git add -A
git commit -m "Initial Hallnect deployment"
# create a repo and push (GitHub example)
gh repo create hallnect --private --source . --push
```
Then in Vercel:
1. **Import** the repo.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`, output handled by Next.
3. Add all env vars from §3.
4. Deploy.

After the first deploy:
- Update Supabase **Site URL** + **Redirect URLs** to the real domain.
- Update Cashfree **notify_url** + **return_url** allow-list to the real domain.
- Update `NEXT_PUBLIC_APP_URL` to the real domain and redeploy if it was a placeholder.

---

## 5. Post-deploy smoke test (do not skip)

Run against the **deployed** URL:

1. **Build/health:** home, `/halls`, a hall detail, all legal pages load (200).
2. **Auth:** sign up as a customer → land on `/customer`. Sign in/out.
3. **Owner:** register as owner (email + Google) → `/approval-pending`. Approve via admin → next login lands on `/owner/dashboard`.
4. **Admin:** confirm `/admin/dashboard` is reachable only as admin; non-admins are redirected.
5. **Listing lifecycle:** owner creates a hall → admin approves → it appears publicly.
6. **Image upload:** upload JPEG/PNG/WebP ≤ 5 MB; reject others.
7. **Availability + booking:** block a slot; book an available slot; confirm double-booking is rejected.
8. **Payment (sandbox):** complete a **successful** advance payment → booking advances, commission row created. Then a **failed** payment → booking not advanced, friendly message.
9. **Webhook:** confirm a signed event is received and applied (check logs show event + order id only).
10. **RLS:** run `docs/QA_CHECKLIST.md` §22 per-role denial tests.
11. **Security:** confirm no secrets in the client bundle/console; `/auth/set-owner-role` → 404; `/auth/callback?next=@evil.com` stays on-origin; raw DB errors never shown.
12. **Mobile:** spot-check landing, listing, detail, booking at 375px.

Cut over to **production Cashfree** only after the sandbox smoke test passes.

---

## 6. Rollback

- Vercel keeps previous deployments — use **Instant Rollback** to the last good deploy.
- DB migrations are forward-only; take a Supabase backup/snapshot before applying 0013–0016 so you can restore if needed.
- Keep `CASHFREE_ENV=sandbox` until the production payment path is confirmed, so a bad deploy can't take live payments.

---

## Known gaps to close before public launch
- ⛔ Apply migrations 0013–0016 (premium/ads/review-sub-ratings/ticket-notes are dark without them).
- ⛔ Complete a real Cashfree sandbox transaction (success + failure + webhook).
- 🟡 Per-role RLS tests against the live DB.
- ⚖️ Legal review of the draft policy pages (they carry an MVP draft-review banner).
