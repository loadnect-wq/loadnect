import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAdminWebhookRequest, postAdminWebhook, isAdminWebhookConfigured } from "@/lib/notifications/admin-webhook";

// ─────────────────────────────────────────────────────────────────────────────
// The second admin-alert transport.
//
// These exist because the ntfy path was DOCUMENTED AS WORKING AND DID NOT.
// Posting the JSON body to https://ntfy.sh/<topic> returns 200 — so the
// function returned true, the log said delivered — while the phone showed
// "You received a file: attachment.json". A comment asserted the behaviour; a
// live send disproved it.
//
// So the shaping is pinned here per vendor, and the ntfy assertions are written
// against what the real service was observed to do.
// ─────────────────────────────────────────────────────────────────────────────

const ALERT = {
  eventKey:  "refunds.overdue:2026-09-15",
  eventType: "refunds.overdue",
  message:   "Refunds overdue — 2 refund(s) totalling Rs.7500.00 owed over 5 days.",
};

const ok = (r: ReturnType<typeof buildAdminWebhookRequest>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r;
};

afterEach(() => {
  delete process.env.ADMIN_ALERT_WEBHOOK_URL;
  vi.restoreAllMocks();
});

describe("ntfy", () => {
  it("moves the topic out of the path and posts to the server root", () => {
    // THE WHOLE BUG. A POST to the topic URL with content-type application/json
    // is treated by ntfy as a FILE UPLOAD, not a message. JSON publishing lives
    // at the root with the topic in the body.
    const r = ok(buildAdminWebhookRequest("https://ntfy.sh/hallnect-abc123", ALERT));
    expect(r.endpoint).toBe("https://ntfy.sh/");
    expect(r.body.topic).toBe("hallnect-abc123");
  });

  it("sends message and title, which are the keys ntfy renders", () => {
    const r = ok(buildAdminWebhookRequest("https://ntfy.sh/t", ALERT));
    expect(r.body.title).toBe("Hallnect");
    // The title carries the brand, so the message must not repeat it.
    expect(r.body.message).toBe(ALERT.message);
    expect(r.body.message.startsWith("Hallnect:")).toBe(false);
  });

  it("keeps the Slack and Discord keys, which ntfy tolerates and ignores", () => {
    // Verified against the live service: the extra keys do not make it 400.
    const r = ok(buildAdminWebhookRequest("https://ntfy.sh/t", ALERT));
    expect(r.body.text).toBe(`Hallnect: ${ALERT.message}`);
    expect(r.body.content).toBe(r.body.text);
  });

  it("handles a trailing slash and a self-hosted subdomain", () => {
    expect(ok(buildAdminWebhookRequest("https://ntfy.sh/mytopic/", ALERT)).body.topic).toBe("mytopic");
    const sub = ok(buildAdminWebhookRequest("https://alerts.ntfy.sh/mytopic", ALERT));
    expect(sub.endpoint).toBe("https://alerts.ntfy.sh/");
    expect(sub.body.topic).toBe("mytopic");
  });

  it("refuses an ntfy URL with no topic rather than posting a topicless body", () => {
    // ntfy would 400 this. Saying so beats a failed-delivery log the operator
    // has to decode.
    const r = buildAdminWebhookRequest("https://ntfy.sh/", ALERT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("no topic");
  });
});

describe("Slack, Discord and self-hosted are posted unchanged", () => {
  it.each([
    ["https://hooks.slack.com/services/T000/B000/XXXX"],
    ["https://discord.com/api/webhooks/123/abc"],
    ["https://alerts.example.com/hook"],
  ])("%s keeps its own URL", (url) => {
    const r = ok(buildAdminWebhookRequest(url, ALERT));
    expect(r.endpoint).toBe(url);
    // No `topic` key leaks into a non-ntfy payload.
    expect(r.body.topic).toBeUndefined();
  });

  it("sends the prefixed string as both text and content", () => {
    const r = ok(buildAdminWebhookRequest("https://hooks.slack.com/services/A/B/C", ALERT));
    expect(r.body.text).toBe(`Hallnect: ${ALERT.message}`);
    expect(r.body.content).toBe(r.body.text);
    expect(r.body.event_key).toBe(ALERT.eventKey);
    expect(r.body.event_type).toBe(ALERT.eventType);
  });
});

describe("a webhook URL is a credential", () => {
  it("refuses http, because the URL is a bearer token in transit", () => {
    const r = buildAdminWebhookRequest("http://ntfy.sh/topic", ALERT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("https");
  });

  it("refuses a malformed URL", () => {
    expect(buildAdminWebhookRequest("https://", ALERT).ok).toBe(false);
  });

  it("never writes the URL to a log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ADMIN_ALERT_WEBHOOK_URL = "http://ntfy.sh/super-secret-topic";
    await postAdminWebhook(ALERT, async () => ({ ok: true, status: 200 }));
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("super-secret-topic");
    expect(logged).toContain("https");
  });

  it("logs only the status on a failed delivery", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://ntfy.sh/super-secret-topic";
    const sent = await postAdminWebhook(ALERT, async () => ({ ok: false, status: 429 }));
    expect(sent).toBe(false);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("super-secret-topic");
    expect(logged).toContain("429");
  });
});

describe("unset is a valid state", () => {
  it("is a no-op with no URL, and reports not-configured", async () => {
    let called = false;
    const sent = await postAdminWebhook(ALERT, async () => { called = true; return { ok: true, status: 200 }; });
    expect(sent).toBe(false);
    expect(called).toBe(false);
    expect(isAdminWebhookConfigured()).toBe(false);
  });

  it("reports configured once an https URL is present", () => {
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://ntfy.sh/t";
    expect(isAdminWebhookConfigured()).toBe(true);
  });
});

describe("never throws", () => {
  it("swallows a transport failure and reports it as undelivered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://ntfy.sh/t";
    // A booking or payout must not fail because its alert did.
    const sent = await postAdminWebhook(ALERT, async () => { throw new Error("ETIMEDOUT"); });
    expect(sent).toBe(false);
  });

  it("posts JSON and actually reaches the rewritten endpoint", async () => {
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://ntfy.sh/hallnect-xyz";
    const seen: { url: string; init: RequestInit }[] = [];
    const sent = await postAdminWebhook(ALERT, async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200 };
    });
    expect(sent).toBe(true);
    expect(seen[0].url).toBe("https://ntfy.sh/");
    expect(JSON.parse(String(seen[0].init.body)).topic).toBe("hallnect-xyz");
    expect(seen[0].init.method).toBe("POST");
  });
});
