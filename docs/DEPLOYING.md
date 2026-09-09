# Deploying Hallnect

Production is Vercel project `hallnect5` (team `loadnect-wq's projects`), serving
`hallnect.com`. The production branch is `main`.

## Verify the deploy actually landed — every time

**`curl https://hallnect.com/` returning 200 proves nothing.** The previous
deployment keeps serving happily, so a failed or skipped build looks identical
to a successful one from the outside.

On 2026-08-29 four consecutive commits reached GitHub and Vercel built none of
them. There were no failed builds to notice, and the site answered 200
throughout.

Use one of these instead:

```bash
# 1. Probe a route that only exists in the new build.
#    404 = not deployed. 307 = deployed (admin routes redirect to login).
curl -s -o /dev/null -w '%{http_code}\n' https://hallnect.com/admin/coupons
```

```bash
# 2. Grep the live HTML for a string only the new build contains.
curl -s https://hallnect.com/ | grep -c "some new copy"
```

```bash
# 3. Compare the deployed commit against local HEAD.
git rev-parse --short HEAD
```

…then check the newest deployment's `meta.githubCommitSha` in the Vercel
dashboard, or via the API.

## Shipping

Push to `main` and confirm a build starts. If it does not:

```bash
npx vercel --prod --yes
```

The CLI deploys the working tree, so **commit first** — otherwise you ship
uncommitted local state. It prints `readyState: READY` and aliases
`hallnect.com` on success.

## Environment variables are baked at BUILD time

Changing one in the Vercel dashboard does **not** affect the running
deployment. A redeploy is required, and given the above, that redeploy may not
happen on its own.

`MSG91_AUTH_KEY`, `MSG91_WEBHOOK_SECRET` and the `CASHFREE_*` credentials are
typed **Sensitive**, which makes them write-only — `vercel env pull` returns the
literal `[SENSITIVE]`. Use the **Config** type for anything that is not a
credential (an `MSG91_TEMPLATE_*` id, a sender ID, a feature flag), so it can be
read back later. `/admin/settings` and `/admin/notifications` surface the values
the app actually resolved, which is the only way to check a Sensitive one.

## Functions run in Mumbai (`bom1`) — the database does not

`vercel.json` carries `"regions": ["bom1"]`. JSON takes no comments, so the
reasoning lives here.

**What changed.** Before commit `cc28452` the repo set no `regions` key, so the
project default applied. Read back from the Vercel deployment API rather than
assumed: the deployment of the preceding commit `b342161` reports
`"regions": ["iad1"]` (Washington, D.C.); the deployment of `cc28452` reports
`"regions": ["bom1"]` (Mumbai). The key sets where **server code** executes —
route handlers, server components, server actions, the cron endpoints. Static
assets are served from the global edge network either way; this does not change
that.

**This is not the co-location win it looks like.** Three locations are involved,
and only two of them moved closer together:

| | Where | Moved? |
|---|---|---|
| Users | Tamil Nadu | fixed |
| Functions | Mumbai (`bom1`) | **was `iad1`, Washington D.C.** |
| Postgres | `ap-southeast-2`, Sydney | fixed |

The Supabase region is not a guess — project `kvcrqhmgthixhqrjytay` reports
`ap-southeast-2`. So every server-to-database round trip still crosses an ocean;
it crosses the Indian Ocean to Australia now instead of the Pacific and a
continent to Virginia, but it crosses one.

**Why it is still the right setting.** The user-to-function hop is now domestic
— Tamil Nadu to Mumbai instead of Tamil Nadu to Virginia — and that hop is paid
on *every* request, including the ones that touch no database at all. The
function-to-database hop improves too, just far less dramatically, and a page
that issues several sequential queries pays that remaining hop several times
over. No latency figures are quoted here because none were measured; the claim
is about geography, not milliseconds. If you want numbers, measure them and add
them.

**The real fix is moving the database.** Pinning the functions treats the
symptom. A Supabase project in Mumbai itself (`ap-south-1`) would put
users, functions and Postgres on one side of the world, and would matter more
than this change did, because the query hop is the one paid repeatedly within a
single request. That is a project migration with real downtime and is not
scheduled — it is recorded here so the `bom1` line is not mistaken for the
problem being solved.

**This project is on Vercel Pro (since 2026-09-09) and cannot go back to
Hobby.** Hobby is restricted to non-commercial use; Hallnect takes payments, so
the Pro plan is a compliance requirement, not a performance choice. It also
carries three cron jobs, which Hobby capped at two.

This paragraph used to say the opposite — "do not add a third `crons` entry, the
Hobby plan caps the project at two" — which was true when written and is now
false in both directions. Cron count and schedule frequency are no longer the
constraint; see `docs/SCHEDULED_JOBS.md` for what actually constrains them
(notification hours, and two jobs never sharing a minute).

**The Pro upgrade also switched on something that can take the site down.**
Vercel Spend Management is enabled by default on Pro with *Pause production
deployment* turned on. An automatic pause on a site running Cashfree checkout is
a payments incident, not a cost control: it 503s the Cashfree webhook, and there
is no replay path for a missed customer-payment webhook. Check
Settings → Billing → Spend Management and decide that deliberately.

## If pushes stop triggering builds

Confirm the git link and that the GitHub App can still see the repo:

```bash
npx vercel project inspect hallnect5
```

In the Vercel dashboard: **Settings → Git**. The GitHub App installation is
scoped to *selected repositories*, so a repo can silently fall out of scope.
Re-connecting the repository there re-registers the webhook.
