// ─────────────────────────────────────────────────────────────────────────────
// lib/cashfree-health.ts — live Cashfree configuration check (SERVER-ONLY).
//
// WHY THIS EXISTS. Vercel marks the Cashfree variables "Sensitive", so their
// values are write-only and cannot be read back — not from the dashboard, not
// from the CLI. That makes "are we actually on production credentials?" an
// unanswerable question at exactly the moment it matters most: the switch from
// sandbox to real money. Getting it wrong is silent and expensive in both
// directions — live keys while you think you are testing, or test keys while
// you think you are charging customers.
//
// This asks the live Cashfree API which credentials it is actually holding and
// reports the answer WITHOUT ever revealing a secret. The probe is a GET for a
// deliberately non-existent order:
//     401 / 403  -> credentials rejected
//     404        -> credentials ACCEPTED (the order simply does not exist)
// It creates nothing, charges nothing, and is safe to run on every page load.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getCashfreeConfig } from "@/lib/cashfree";
import { isEasySplitEnabled } from "@/lib/easy-split";
import { getCanonicalAppUrl } from "@/lib/app-url";

export type CashfreeHealth = {
  configured: boolean;
  /** Resolved from CASHFREE_ENV — what the code will actually use. */
  mode: "production" | "sandbox" | null;
  apiBaseUrl: string | null;
  /** Masked — never the full id, never the secret. */
  appIdMasked: string | null;
  /** Cashfree test App IDs begin with "TEST". */
  appIdLooksLikeTestKey: boolean;
  /** Live probe result against apiBaseUrl. */
  credentialsAccepted: boolean | null;
  credentialsError: string | null;
  /** Set separately, or silently falling back to the API secret? */
  webhookSecretConfigured: boolean;
  /** The return_url / notify_url origin the gateway will be handed. */
  callbackOrigin: string;
  webhookUrl: string;
  /** NEXT_PUBLIC_CASHFREE_ENV is read by NO code; a wrong value here is
   *  harmless but misleading, so surface it rather than leave it confusing. */
  publicEnvVarValue: string | null;
  publicEnvVarMisleading: boolean;
  /** True when mode and key type disagree — the dangerous combination. */
  modeKeyMismatch: boolean;
  /**
   * CASHFREE_EASY_SPLIT_ENABLED. Also write-only in Vercel, and it decides
   * whether an accepted booking pays the owner at all: with it off, every
   * payout records 'not_applicable' and the owner's share simply stays in
   * Hallnect's account. Surfaced here because there is no other way to read it.
   */
  easySplitEnabled: boolean;
};

export async function checkCashfreeHealth(): Promise<CashfreeHealth> {
  const callbackOrigin = getCanonicalAppUrl();
  const publicEnvVarValue = process.env.NEXT_PUBLIC_CASHFREE_ENV?.trim() ?? null;

  const base: CashfreeHealth = {
    configured: false,
    mode: null,
    apiBaseUrl: null,
    appIdMasked: null,
    appIdLooksLikeTestKey: false,
    credentialsAccepted: null,
    credentialsError: null,
    webhookSecretConfigured: !!process.env.CASHFREE_WEBHOOK_SECRET?.trim(),
    callbackOrigin,
    webhookUrl: `${callbackOrigin}/api/webhooks/cashfree`,
    publicEnvVarValue,
    // Only "production" / "sandbox" are meaningful; anything else (e.g. someone
    // pasting an API base URL here) is a sign of a misunderstanding.
    publicEnvVarMisleading:
      publicEnvVarValue !== null &&
      publicEnvVarValue !== "production" &&
      publicEnvVarValue !== "sandbox",
    modeKeyMismatch: false,
    easySplitEnabled: isEasySplitEnabled(),
  };

  let cfg;
  try {
    cfg = getCashfreeConfig();          // throws when APP_ID / SECRET are absent
  } catch {
    return base;                        // not configured — manual booking mode
  }

  const isTestKey = cfg.appId.toUpperCase().startsWith("TEST");
  const health: CashfreeHealth = {
    ...base,
    configured: true,
    mode: cfg.env,
    apiBaseUrl: cfg.baseUrl,
    appIdMasked: `${cfg.appId.slice(0, 4)}…${cfg.appId.slice(-4)}`,
    appIdLooksLikeTestKey: isTestKey,
    // production mode + TEST key, or sandbox mode + live key: either way the
    // gateway will reject the credentials, and the failure only shows up when a
    // real customer tries to pay.
    modeKeyMismatch: (cfg.env === "production") === isTestKey,
  };

  // Read-only credential probe. A well-formed but non-existent order id.
  try {
    const res = await fetch(`${cfg.baseUrl}/orders/hallnect_healthcheck_nonexistent`, {
      method: "GET",
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": cfg.appId,
        "x-client-secret": cfg.secretKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      // Authenticated fine; the order genuinely does not exist.
      return { ...health, credentialsAccepted: true };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ...health,
        credentialsAccepted: false,
        credentialsError: `Cashfree rejected these credentials for ${cfg.env} (HTTP ${res.status}).`,
      };
    }
    // A gateway error proves NOTHING about the credentials — the request never
    // reached the part of Cashfree that checks them. Reporting "accepted" here
    // was a false green during a Cashfree outage, which is precisely when an
    // operator most needs to trust this panel. Unknown is the honest answer.
    if (res.status >= 500) {
      return {
        ...health,
        credentialsAccepted: null,
        credentialsError: `Cashfree returned HTTP ${res.status} — its API is having trouble, so the credentials could not be checked.`,
      };
    }
    // Any other status did reach authentication and got past it.
    return { ...health, credentialsAccepted: true, credentialsError: `Unexpected HTTP ${res.status} (treated as reachable).` };
  } catch {
    return { ...health, credentialsAccepted: null, credentialsError: "Could not reach the Cashfree API to verify." };
  }
}
