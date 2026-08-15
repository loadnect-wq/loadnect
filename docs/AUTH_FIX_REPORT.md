# Hallnect — Authentication Audit & Fix Report

**Date:** 2026-06-28

## Summary
The auth system was audited and hardened across this build. No auth errors remain in the code paths; the two real vulnerabilities found earlier (open redirect, CSRF role-change) are fixed and verified.

## Auth flows (verified by inspection)
| Flow | Status |
|---|---|
| Customer signup → `customer` role | ✅ via Supabase signUp + `handle_new_user` trigger |
| Owner registration → `owner_pending` | ✅ email path (role metadata) + Google path (callback upgrade) |
| Login (email + Google) | ✅ → `/auth/redirect` → role router |
| Logout | ✅ clears session; protected routes redirect to `/login` |
| Profile creation after signup | ✅ DB trigger `handle_new_user` (auto-creates `profiles` row) |
| `owner_pending` → `/approval-pending` | ✅ gated page |
| `owner_approved` → `/owner/dashboard` | ✅ `requireRole(["owner_approved"])` |
| `customer` → `/customer` | ✅ |
| `admin` → `/admin/dashboard` | ✅ `requireRole(["admin"])` |
| Admin not self-assignable | ✅ `handle_new_user` maps `owner`→`owner_pending` only; RLS + `prevent_role_change` |
| User cannot update own role | ✅ RLS `WITH CHECK` + `prevent_role_change` trigger |

## Fixes applied (this build series)
- **Open redirect** in `/auth/callback`: `next` param validated to an internal allow-list (`safeNext`); hostile payloads (`@evil.com`, `//evil.com`) stay on-origin.
- **CSRF role-change endpoint removed**: the forgeable `GET /auth/set-owner-role` was deleted; the `customer → owner_pending` upgrade now happens inside the callback **after a verified, single-use OAuth code exchange**.
- **Owner-registration robustness**: the post-OAuth upgrade routes through the role router (`/auth/redirect`) so it self-corrects instead of bouncing.
- **Production-safe session middleware** (`proxy.ts`): guards for missing Supabase env + wraps `auth.getUser()` in try/catch — a session-refresh failure can't 500 every route. Route protection still happens server-side in layouts.
- **Vercel env crash fixed**: missing `NEXT_PUBLIC_SUPABASE_*` no longer crashes every route (see `VERCEL_500_FIX_REPORT.md`).

## Route protection (server-side, not UI-only)
`requireRole()` runs in the admin/owner/customer layouts on every nested render. Logged-out users hitting private routes get a `307` to `/login`. Wrong-role users are routed to their own dashboard. Verified via route sweep (private routes redirect, never 500).

## Known operational items (not code defects)
- The Google owner-registration happy path needs a real OAuth provider to exercise end-to-end (verify in staging).
- Per-role RLS denial tests should be run against the live DB (`docs/SUPABASE_RLS_TESTING_GUIDE.md`).
- After deploy: set Supabase Auth **Site URL** + add `https://<domain>/auth/callback` to the redirect allow-list, or OAuth/email-confirm links will mismatch.
