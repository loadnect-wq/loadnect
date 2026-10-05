import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The "built but not fully working" items closed on 2026-10-05: the visit SMS
// to venues, error alerts, and iPhone date alerts.
// ─────────────────────────────────────────────────────────────────────────────

const notifyAdminOperational = vi.fn(async (_input: unknown) => {});
let errorCount = 0;
let countFails = false;

vi.mock("@/lib/notifications/events", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications/events")>()),
  notifyAdminOperational: (input: unknown) => notifyAdminOperational(input),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => Promise.resolve(countFails ? { count: null, error: { message: "down" } } : { count: errorCount, error: null }),
      };
      return q;
    },
  }),
}));

const { ownerVisitNotification } = await import("../notifications/events");
const { renderTemplate, coerceVariables } = await import("../notifications/sms-templates");
const { DAILY_CAP, alertFor, alertServerError, errorFingerprint, isIgnorable, maskMessage } = await import("../error-alerts");
const { isIosDevice, pushSupportFor } = await import("../date-alerts");

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("visit request SMS to the venue", () => {
  it("rides the approved owner template with no phone number and every value within 30 characters", () => {
    const n = ownerVisitNotification({ hallName: "Sri Meenakshi Sundareswarar Kalyana Mandapam", contactName: "Lakshmi Narayanan", dateLabel: "Sat, 10 Oct 2026" });
    expect(n.templateKey).toBe("OWNER_ACCOUNT_STATUS");
    for (const v of n.templateVariables) expect(v.length).toBeLessThanOrEqual(30);
    expect(n.templateVariables[1]).toBe("New site visit request");
    const text = renderTemplate(n.templateKey, coerceVariables(n.templateKey, n.templateVariables));
    expect(text).toContain("Sign in to your owner dashboard to review it.");
    expect(text).not.toMatch(/\d{10}/);
  });

  it("is sent once per new request, never for a repeat", () => {
    const action = read("app/visit/[slug]/actions.ts");
    expect(action).toContain("if (!result.already) await notifyVisitRequested(result.visitId);");
  });
});

describe("error alerts", () => {
  beforeEach(() => {
    notifyAdminOperational.mockClear();
    errorCount = 0;
    countFails = false;
  });

  const report = { routePath: "/plan/[id]", routeType: "render", name: "TypeError", message: "Cannot read properties of undefined (reading 'id')" };

  it("ignores noise: stale server actions and abandoned requests", () => {
    expect(isIgnorable("Error", 'Failed to find Server Action "abc". This request might be from an older deployment.')).toBe(true);
    expect(isIgnorable("AbortError", "The operation was aborted")).toBe(true);
    expect(isIgnorable("TypeError", "x is undefined")).toBe(false);
  });

  it("masks anything that could identify a person", () => {
    const m = maskMessage('duplicate key value (phone)=(+91 98765 43210) for priya@example.com in 3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b');
    expect(m).not.toMatch(/98765|43210|priya|example\.com|3f1a2b4c/);
    expect(m).toContain("[email]");
    expect(m).toContain("[id]");
  });

  it("gives the same error the same fingerprint whatever id it mentions, and fits the SMS", () => {
    const a = errorFingerprint({ ...report, message: "Plan 3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b not found" });
    const b = errorFingerprint({ ...report, message: "Plan 8c7d6e5f-4a3b-2c1d-9e8f-7a6b5c4d3e2f not found" });
    expect(a).toBe(b);
    expect(errorFingerprint({ ...report, routePath: "/halls" })).not.toBe(a);
    const alert = alertFor({ ...report, name: "AVeryLongCustomErrorNameThatGoesOnAndOn", message: "x".repeat(300) }, "2026-10-05");
    expect(alert.details.length).toBeLessThanOrEqual(60);
    expect(alert.reference.length).toBeLessThanOrEqual(60);
    expect(alert.key).toMatch(/^app\.error:[0-9a-f]{12}:2026-10-05$/);
    expect(alert.immediate).toBe(true);
  });

  it("alerts the admin, but not past the daily cap or when the count cannot be read", async () => {
    await alertServerError(report);
    expect(notifyAdminOperational).toHaveBeenCalledTimes(1);
    errorCount = DAILY_CAP;
    await alertServerError(report);
    countFails = true;
    await alertServerError(report);
    await alertServerError({ ...report, name: "AbortError" });
    expect(notifyAdminOperational).toHaveBeenCalledTimes(1);
  });

  it("is wired into the error hook, awaited, and on the Node runtime only", () => {
    const hook = read("instrumentation.ts");
    expect(hook).toContain("export const onRequestError: Instrumentation.onRequestError = async");
    expect(hook).toContain('if (process.env.NEXT_RUNTIME !== "nodejs") return;');
    expect(hook).toContain("await alertServerError(");
  });
});

describe("date alerts on iPhone", () => {
  it("sends an iPhone to the Home Screen instead of calling it unsupported", () => {
    expect(pushSupportFor({ hasPush: true, ios: true, standalone: true })).toBe("supported");
    expect(pushSupportFor({ hasPush: false, ios: true, standalone: false })).toBe("ios-add-to-home-screen");
    expect(pushSupportFor({ hasPush: false, ios: true, standalone: true })).toBe("ios-update");
    expect(pushSupportFor({ hasPush: false, ios: false, standalone: false })).toBe("unsupported");
  });

  it("recognises iPhones and iPads, including iPads that say they are Macs", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });

  it("makes /halls installable as a standalone app", () => {
    const manifest = JSON.parse(read("public/hallnect.webmanifest"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/halls");
    expect(read("app/halls/page.tsx")).toContain('manifest: "/hallnect.webmanifest"');
  });
});
