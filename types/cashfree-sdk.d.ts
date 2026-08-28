// ─────────────────────────────────────────────────────────────────────────────
// The Cashfree v3 browser SDK, declared ONCE.
//
// It was declared separately in the booking flow and in the plan subscription
// component, and the two drifted: one knew about checkout(), the other about
// subscriptionsCheckout(), and TypeScript rejected the pair as conflicting
// declarations of the same global. Both surfaces load the same script from the
// same URL, so there is exactly one correct shape and it belongs here.
//
// Verified against the real bundle at https://sdk.cashfree.com/js/v3/cashfree.js:
//   checkout({ paymentSessionId })  — one-off orders
//   subscriptionsCheckout({ subsSessionId }) — mandates
// Both build a form and POST it to Cashfree, which is why every Cashfree host
// must appear in the CSP's form-action list (see next.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

interface CashfreeCheckoutOptions {
  paymentSessionId: string;
  redirectTarget?: string;
}

interface CashfreeSubscriptionCheckoutOptions {
  subsSessionId: string;
  redirectTarget?: string;
}

interface CashfreeInstance {
  checkout: (o: CashfreeCheckoutOptions) => Promise<unknown> | void;
  subscriptionsCheckout: (o: CashfreeSubscriptionCheckoutOptions) => Promise<unknown> | void;
}

interface Window {
  Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;
}
