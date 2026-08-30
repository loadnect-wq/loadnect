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

Most `TWILIO_*` and `CASHFREE_*` vars are typed **Sensitive**, which makes them
write-only — `vercel env pull` returns the literal `[SENSITIVE]`. Prefer the
**Config** type for anything that is not a credential (a Twilio Content SID, a
feature flag), so it can be read back later. `/admin/settings` surfaces the
values the app actually resolved, which is the only way to check a Sensitive one.

## If pushes stop triggering builds

Confirm the git link and that the GitHub App can still see the repo:

```bash
npx vercel project inspect hallnect5
```

In the Vercel dashboard: **Settings → Git**. The GitHub App installation is
scoped to *selected repositories*, so a repo can silently fall out of scope.
Re-connecting the repository there re-registers the webhook.
