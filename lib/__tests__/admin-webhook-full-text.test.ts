import { describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The SMS is cut to 30 characters a variable; the admin webhook is not
// (2026-10-11).
//
// The cap is a DLT rule, and the webhook (Slack, Discord, ntfy) is not DLT.
// It is also the only admin channel that works without an approved template,
// so it must keep the detail the SMS has no room for: "Gateway captured Rs.X
// but Rs.Y was expected..." is the line the operator acts on.
// ─────────────────────────────────────────────────────────────────────────────

const inserted: Record<string, unknown>[] = [];
const webhookMessages: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from() {
      const chain = {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return chain;
        },
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: "n1", status: "pending" }, error: null }),
        // attemptSend's first read: nothing found, so no provider call is made.
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/notifications/admin-webhook", () => ({
  postAdminWebhook: vi.fn(async (a: { message: string }) => {
    webhookMessages.push(a.message);
    return true;
  }),
}));

import { dispatchNotification } from "@/lib/notifications/service";

describe("an admin alert", () => {
  it("is stored and texted at 30 characters a variable, but posted to the webhook whole", async () => {
    const details = "Gateway captured Rs.25,000 but Rs.20,000 was expected. The money is held.";
    await dispatchNotification({
      eventKey: "payment.amount_mismatch:o1",
      eventType: "payment.amount_mismatch",
      recipientType: "admin",
      phone: "+919000000001",
      templateKey: "ADMIN_ALERT",
      templateVariables: ["Payment amount MISMATCH", details, "order o1"],
      immediate: true,
    });

    expect(inserted).toHaveLength(1);
    const stored = inserted[0].template_variables as string[];
    expect(stored[1]).toBe("Gateway captured Rs.25,000...");
    expect(stored.every((v) => v.length <= 30)).toBe(true);
    expect(inserted[0].message).not.toContain("was expected");

    expect(webhookMessages).toHaveLength(1);
    expect(webhookMessages[0]).toContain(details);
  });
});
