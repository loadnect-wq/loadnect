# Commission Overdue Check — Cron Setup

The overdue sweep can run on a schedule via **Vercel Cron** (or any scheduler /
`curl`). It is safe to run daily — the engine is idempotent and never double-deducts.

## The endpoint
```
POST /api/admin/commissions/run-overdue-check
```
Authorized two ways (either is sufficient):
1. A logged-in **admin** session (used by the in-app "Run overdue check" button).
2. A machine caller presenting the shared secret:
   `Authorization: Bearer <CRON_SECRET>` (constant-time compared).

If `CRON_SECRET` is **unset**, the header path is disabled — there is no
empty-secret bypass; only an admin session works. The route takes no body.

## 1. Set the secret
Generate a strong random value and add it in Vercel → Project → Settings →
Environment Variables (Production):
```bash
CRON_SECRET=<64+ random chars>
```
Also add it locally in `.env.local` for testing (never commit it).

## 2. Add the cron job — `vercel.json`
```json
{
  "crons": [
    { "path": "/api/admin/commissions/run-overdue-check", "schedule": "0 3 * * *" }
  ]
}
```
This runs daily at 03:00 UTC. Vercel Cron automatically sends the
`Authorization: Bearer $CRON_SECRET` header for you when `CRON_SECRET` is set.

## 3. Manual test with curl
```bash
curl -X POST https://<your-app>/api/admin/commissions/run-overdue-check \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `{ "ok": true, "summary": { markedOverdue, adjustmentsCreated,
adjustmentsSkipped, autoAdjustEnabled, ... } }`.

## Notes
- Auto-adjustment only creates deductions when
  `platform_settings.enable_auto_commission_adjustment` is **on**
  (Admin → Settings → Payments & commission). With it off, the sweep only marks
  commissions overdue.
- The route logs a one-line JSON summary (`[commissions:run-overdue-check]`) — no
  secrets are logged.
- Redeploy after changing `CRON_SECRET` or `vercel.json`.
