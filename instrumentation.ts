// ─────────────────────────────────────────────────────────────────────────────
// instrumentation.ts — the app's startup and error hooks.
//
// WHY THIS FILE EXISTS. lib/env.ts has shipped a validateEnv() since the
// beginning, and its own docblock says to call it "during app startup (e.g. in
// instrumentation.ts)". No such file existed, so nothing ever called it. The
// consequence was not theoretical: a missing SUPABASE_SERVICE_ROLE_KEY stayed
// invisible through build and boot and surfaced as a 500 on whichever page
// first touched the admin client — a booking insert, a payment webhook — with
// the failure landing on a customer instead of on the deploy.
//
// register() runs ONCE per server instance and must finish before the first
// request is served, so throwing here turns "the checkout is broken for
// everyone and nobody knows why" into one loud, named failure. That is the
// trade being made deliberately: a loud boot failure is cheaper to diagnose
// than a quiet runtime one, particularly on a plan that does not retain logs.
//
// KNOW WHAT THAT TRADE COSTS BEFORE ADDING TO validateEnv(). Throwing here does
// NOT stop a bad deployment going live, and the older wording here said it did.
// Next skips register() during phase-production-build (verified in the
// installed next@16.3.1, server/lib/router-utils/instrumentation-globals
// .external.js), so `next build` never runs this and the deployment builds and
// promotes clean; the throw happens when a SERVER instance boots, and every
// request it touches then fails. So a variable added to validateEnv() takes the
// WHOLE SITE down when it is absent, not just the feature that needs it. That
// is the right call for a variable the site genuinely cannot serve without, and
// the wrong one for anything that degrades safely — lib/env.ts lists which is
// which, and why, next to the production set.
//
// NO SDK, NO DEPENDENCY. There is still no Sentry and no error-tracking
// service; onRequestError below writes structured lines to stdout, which is all
// that can be done without a paid service and an owner's decision. It is a
// floor, not error monitoring — see docs and the launch audit.
// ─────────────────────────────────────────────────────────────────────────────

import type { Instrumentation } from "next";

/**
 * Fail the boot rather than the first request that needs a missing variable.
 *
 * NODEJS RUNTIME ONLY. Next calls register() in every runtime, and lib/env.ts
 * is server-only Node code that also pulls in lib/app-url.ts; importing it into
 * an Edge instance would fail the boot for the wrong reason entirely. The
 * dynamic import keeps that module out of the Edge bundle rather than merely
 * skipping the call.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("@/lib/env");
  validateEnv();
}

/**
 * Every uncaught server error, in one greppable line.
 *
 * This is not a replacement for error monitoring — nothing here alerts anyone,
 * and Vercel's Hobby plan keeps runtime logs briefly. What it buys is that an
 * error that reaches a user is at least ATTRIBUTED while the log survives:
 * which route, which kind of work (a render, a route handler, a server action),
 * and the digest that the user's error page shows them. Without it, a support
 * message quoting a digest could not be matched to anything at all.
 *
 * NEVER THROWS, and never logs the request headers. Headers carry the session
 * cookie and the cron bearer token, and a log line is the last place either
 * should end up — the whole point of this hook is that it is safe to leave on.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  try {
    const error = err instanceof Error ? err : null;
    console.error(
      "[error]",
      JSON.stringify({
        path:       request.path,
        method:     request.method,
        routePath:  context.routePath,
        routeType:  context.routeType,
        routerKind: context.routerKind,
        // React may re-throw a different instance than the one that was raised,
        // so the digest is the only thing that reliably ties this line to the
        // reference shown on the user's error page.
        digest:
          typeof err === "object" && err !== null && "digest" in err
            ? String((err as { digest?: unknown }).digest)
            : undefined,
        name:    error?.name,
        message: error ? error.message : String(err),
      }),
    );
    // Separate line: stack traces do not belong inside a JSON field, where they
    // arrive escaped and unreadable in the log viewer.
    if (error?.stack) console.error(error.stack);
  } catch {
    // A logger that can throw would turn one failed request into a failed
    // server. Nothing in this hook is worth that.
  }
};
