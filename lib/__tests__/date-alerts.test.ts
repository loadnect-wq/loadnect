import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";
import { alertMessage, bookedSentence, isAllowedPushEndpoint } from "../date-alerts";
import { countBookedHalls, hasValidPushKeys, isAlertableDate, processDateAlerts, pushOptions, type PushSender } from "../date-alerts.server";
import { dateAlertSubscribeSchema } from "../validation/schemas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ece = createRequire(import.meta.url)("http_ece");

// ── The rules ────────────────────────────────────────────────────────────────

describe("which push addresses the server will ever send to", () => {
  it("accepts the real push services", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXutnMH",
      "https://wns2-pn1p.notify.windows.com/w/?token=BQYAAA",
    ]) expect(isAllowedPushEndpoint(u), u).toBe(true);
  });

  it("refuses anything else, including look-alikes", () => {
    for (const u of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evil.example/fcm.googleapis.com",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://notify.windows.com.evil.example/x",
      "https://localhost/push",
      "not a url",
    ]) expect(isAllowedPushEndpoint(u), u).toBe(false);
  });

  it("validates a real browser's keys and refuses junk", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const p256dh = ecdh.getPublicKey().toString("base64url");
    const auth = randomBytes(16).toString("base64url");
    expect(hasValidPushKeys(p256dh, auth)).toBe(true);
    expect(hasValidPushKeys("B".repeat(87), auth)).toBe(false);
    expect(hasValidPushKeys(p256dh, "a".repeat(22))).toBe(true); // 16 bytes of base64url
    expect(hasValidPushKeys(p256dh, "a".repeat(30))).toBe(false);
  });

  it("schema: city is optional, blank means every city", () => {
    const base = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "B".repeat(87),
      auth: "a".repeat(22),
      date: "2026-11-12",
    };
    expect(dateAlertSubscribeSchema.parse({ ...base, city: "" }).city).toBeNull();
    expect(dateAlertSubscribeSchema.parse({ ...base, city: "Madurai" }).city).toBe("Madurai");
    expect(dateAlertSubscribeSchema.safeParse({ ...base, city: "Madurai<script>" }).success).toBe(false);
    expect(dateAlertSubscribeSchema.safeParse({ ...base, endpoint: "https://evil.example/x" }).success).toBe(false);
  });

  it("only watches dates from today to about eighteen months out", () => {
    expect(isAlertableDate("2026-10-03", "2026-10-03")).toBe(true);
    expect(isAlertableDate("2026-10-02", "2026-10-03")).toBe(false);
    expect(isAlertableDate("2028-04-05", "2026-10-03")).toBe(true);
    expect(isAlertableDate("2028-04-06", "2026-10-03")).toBe(false);
  });
});

describe("what the family reads", () => {
  const hall = { id: "h1", name: "Sri Mahal", slug: "sri-mahal" };

  it("names the hall and the date, and never says free", () => {
    const m = alertMessage(hall, "2026-11-12");
    expect(m.title).toBe("Sri Mahal · Thu, 12 Nov");
    expect(m.body).toContain("no longer has your date booked on Hallnect");
    expect(m.body).toContain("The hall confirms your date with you.");
    expect(`${m.title} ${m.body}`).not.toMatch(/\bfree\b|available/i);
    expect(m.url).toBe("/halls/sri-mahal");
  });

  it("counts booked halls in plain words", () => {
    expect(bookedSentence(1, "Thu, 12 Nov", "Madurai")).toBe("1 hall in Madurai already has Thu, 12 Nov booked.");
    expect(bookedSentence(3, "Thu, 12 Nov", null)).toBe("3 halls already have Thu, 12 Nov booked.");
  });
});

// ── The real wire format ─────────────────────────────────────────────────────

describe("a push as the browser receives it", () => {
  it("is signed for the push service and decrypts to the alert", () => {
    const vapid = webpush.generateVAPIDKeys();
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = randomBytes(16).toString("base64url");
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
      keys: { p256dh: browser.getPublicKey().toString("base64url"), auth },
    };
    const alert = alertMessage({ id: "h1", name: "Sri Mahal", slug: "sri-mahal" }, "2026-11-12");

    const req = webpush.generateRequestDetails(sub, JSON.stringify(alert), pushOptions(vapid));
    expect(req.endpoint).toBe(sub.endpoint);
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(Number(req.headers.TTL)).toBe(86400);

    // VAPID: the JWT names the push service's origin and our contact address.
    const authz = String(req.headers.Authorization);
    expect(authz).toContain(`k=${vapid.publicKey}`);
    const jwt = /t=([^,]+)/.exec(authz)![1];
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:hallnect@gmail.com");

    // Only the browser's private key opens it — and it opens to exactly the alert.
    const plain = ece.decrypt(req.body, { version: "aes128gcm", privateKey: browser, authSecret: auth });
    expect(JSON.parse(plain.toString("utf8"))).toEqual(alert);
  });
});

// ── The sender, against an in-memory database ────────────────────────────────

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for processDateAlerts. */
class FakeDb {
  constructor(public tables: Record<string, Row[]>) {}
  from(table: string) { return new FakeQuery(this, table); }
}

class FakeQuery {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private values: Row = {};
  private head = false;
  private returning = false;
  private single = false;
  private limitN = Infinity;
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { head?: boolean }) {
    if (this.op === "select") this.head = Boolean(opts?.head);
    else this.returning = true;
    return this;
  }
  insert(row: Row) { this.op = "insert"; this.values = row; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  not(c: string, _op: "is", _v: null) { this.filters.push((r) => r[c] != null); return this; }
  order() { return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.single = true; return this; }

  then<T>(resolve: (v: { data: unknown; error: { code: string } | null; count?: number }) => T) {
    return Promise.resolve(this.exec()).then(resolve);
  }

  private exec() {
    const rows = (this.db.tables[this.table] ??= []);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      if (this.table === "date_alert_deliveries" &&
          rows.some((r) => r.subscription_id === this.values.subscription_id && r.hall_id === this.values.hall_id)) {
        return { data: null, error: { code: "23505" } };
      }
      rows.push({ id: `row-${rows.length + 1}`, ...this.values });
      return { data: null, error: null };
    }
    if (this.op === "update") {
      match.forEach((r) => Object.assign(r, this.values));
      return { data: this.returning ? match.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !match.includes(r));
      return { data: null, error: null, count: match.length };
    }
    const data = match.slice(0, this.limitN);
    return { data: this.head ? null : this.single ? (data[0] ?? null) : data, error: null, count: match.length };
  }
}

const TODAY = "2026-10-03";
const D = "2026-11-12";

function world() {
  return new FakeDb({
    halls: [
      { id: "h1", name: "Sri Mahal", slug: "sri-mahal", city: "Madurai", status: "approved" },
      { id: "h2", name: "Pending Hall", slug: "pending-hall", city: "Madurai", status: "pending_review" },
      { id: "h3", name: "Kovai Hall", slug: "kovai-hall", city: "Coimbatore", status: "approved" },
    ],
    availability: [],
    date_alert_subscriptions: [
      { id: "s-madurai", endpoint: "https://fcm.googleapis.com/fcm/send/m", p256dh: "k", auth: "a", date: D, city: "Madurai", failure_count: 0 },
      { id: "s-chennai", endpoint: "https://fcm.googleapis.com/fcm/send/c", p256dh: "k", auth: "a", date: D, city: "Chennai", failure_count: 0 },
      { id: "s-any", endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "k", auth: "a", date: D, city: null, failure_count: 0 },
      { id: "s-past", endpoint: "https://fcm.googleapis.com/fcm/send/p", p256dh: "k", auth: "a", date: "2026-10-01", city: null, failure_count: 0 },
    ],
    date_alert_events: [],
    date_alert_deliveries: [],
  });
}

function event(db: FakeDb, hall_id: string, date = D) {
  db.tables.date_alert_events.push({ id: `e-${db.tables.date_alert_events.length + 1}`, hall_id, date, created_at: "2026-10-03T10:00:00Z", processed_at: null });
}

function recorder(fail: Record<string, number> = {}) {
  const calls: { endpoint: string; payload: Record<string, string> }[] = [];
  const send: PushSender = async (t, payload) => {
    if (fail[t.endpoint]) throw Object.assign(new Error("push failed"), { statusCode: fail[t.endpoint] });
    calls.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
  };
  return { calls, send };
}

describe("processDateAlerts", () => {
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("tells every browser watching that date in that hall's city, once", async () => {
    const db = world();
    event(db, "h1");
    const { calls, send } = recorder();
    const s = await processDateAlerts({ db, send, today: TODAY });

    expect(s).toMatchObject({ configured: true, events: 1, sent: 2, skipped: 0, cleaned: 1, errors: 0 });
    expect(calls.map((c) => c.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/m",
      "https://fcm.googleapis.com/fcm/send/x",
    ]);
    expect(calls[0].payload.title).toBe("Sri Mahal · Thu, 12 Nov");
    expect(db.tables.date_alert_events[0].processed_at).not.toBeNull();
    expect(db.tables.date_alert_subscriptions.some((r) => r.id === "s-past")).toBe(false);

    // A second run, and a second event for the same hall: nobody hears twice.
    expect((await processDateAlerts({ db, send, today: TODAY })).sent).toBe(0);
    event(db, "h1");
    expect((await processDateAlerts({ db, send, today: TODAY })).sent).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("re-checks before sending: booked again, withdrawn or deleted halls are not news", async () => {
    const db = world();
    db.tables.availability.push({ id: "a1", hall_id: "h1", date: D, status: "offline_booked" });
    event(db, "h1");      // the owner deleted and re-added the entry
    event(db, "h2");      // not approved
    event(db, "gone");    // hall deleted (the cascade case)
    event(db, "h1", "2026-10-01"); // a date already past
    const { calls, send } = recorder();
    const s = await processDateAlerts({ db, send, today: TODAY });
    expect(s).toMatchObject({ events: 4, sent: 0, skipped: 4 });
    expect(calls).toHaveLength(0);
  });

  it("matches the city exactly: a Coimbatore hall does not alert a Madurai search", async () => {
    const db = world();
    event(db, "h3");
    const { calls, send } = recorder();
    await processDateAlerts({ db, send, today: TODAY });
    expect(calls.map((c) => c.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/x"]);
  });

  it("drops a subscription the push service says is gone", async () => {
    const db = world();
    event(db, "h1");
    const { send } = recorder({ "https://fcm.googleapis.com/fcm/send/m": 410 });
    const s = await processDateAlerts({ db, send, today: TODAY });
    expect(s).toMatchObject({ sent: 1, expired: 1 });
    expect(db.tables.date_alert_subscriptions.some((r) => r.id === "s-madurai")).toBe(false);
  });

  it("retries a transient failure on the next run, and only for that browser", async () => {
    const db = world();
    event(db, "h1");
    const first = recorder({ "https://fcm.googleapis.com/fcm/send/m": 503 });
    const s1 = await processDateAlerts({ db, send: first.send, today: TODAY });
    expect(s1).toMatchObject({ sent: 1, failed: 1 });
    expect(db.tables.date_alert_events[0].processed_at).toBeNull(); // reopened
    expect(db.tables.date_alert_subscriptions.find((r) => r.id === "s-madurai")?.failure_count).toBe(1);

    const second = recorder();
    const s2 = await processDateAlerts({ db, send: second.send, today: TODAY });
    expect(s2.sent).toBe(1);
    expect(second.calls.map((c) => c.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/m"]);
  });

  it("gives up on a browser after five failures", async () => {
    const db = world();
    const m = db.tables.date_alert_subscriptions.find((r) => r.id === "s-madurai")!;
    m.failure_count = 4;
    event(db, "h1");
    await processDateAlerts({ db, send: recorder({ [String(m.endpoint)]: 500 }).send, today: TODAY });
    expect(db.tables.date_alert_subscriptions.some((r) => r.id === "s-madurai")).toBe(false);
  });

  it("without VAPID keys sends nothing and leaves the events for later", async () => {
    const db = world();
    event(db, "h1");
    const s = await processDateAlerts({ db, today: TODAY });
    expect(s.configured).toBe(false);
    expect(db.tables.date_alert_events[0].processed_at).toBeNull();
    expect(s.cleaned).toBe(1); // housekeeping still runs
  });
});

describe("countBookedHalls", () => {
  it("counts the approved halls a date search hides, in the searched city", async () => {
    const db = world();
    db.tables.availability.push(
      { id: "a1", hall_id: "h1", date: D, status: "offline_booked" },
      { id: "a2", hall_id: "h1", date: D, status: "booked" },        // same hall twice: one hall
      { id: "a3", hall_id: "h2", date: D, status: "blocked" },       // not approved
      { id: "a4", hall_id: "h3", date: D, status: "full_day_booked" },
      { id: "a5", hall_id: "h3", date: "2026-11-13", status: "blocked" },
      { id: "a6", hall_id: "h1", date: D, status: "morning_booked" }, // half a day: still searchable
    );
    expect(await countBookedHalls(D, "Madurai", db)).toBe(1);
    expect(await countBookedHalls(D, null, db)).toBe(2);
    expect(await countBookedHalls(D, "Chennai", db)).toBe(0);
    expect(await countBookedHalls("2026-12-25", null, db)).toBe(0);
  });

  it("returns null, not zero, when the read fails", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { code: "42501", message: "denied" } }) }) }) }) };
    expect(await countBookedHalls(D, null, broken)).toBeNull();
  });
});

// ── The pieces that must stay true ───────────────────────────────────────────

describe("guard rails", () => {
  const migration = read("supabase/migrations/0108_date_alerts.sql");

  it("the trigger can never fail an owner's diary edit or a hall deletion", () => {
    expect(migration).toMatch(/exception when others then\s+raise warning/);
    expect(migration).toContain("hall_id      uuid not null,   -- deliberately no FK");
    expect(migration).not.toMatch(/date_alert_events[\s\S]{0,200}references public\.halls/);
    // Its full-day set is the search's.
    expect(migration).toContain("array['booked','blocked','full_day_booked','maintenance','offline_booked']");
  });

  it("no client role can read or write the alert tables", () => {
    for (const t of ["date_alert_subscriptions", "date_alert_events", "date_alert_deliveries"]) {
      expect(migration).toContain(`revoke all on public.${t}`);
      expect(migration).toContain(`grant all on public.${t}`);
    }
  });

  it("the service worker shows notifications and nothing else", () => {
    const sw = read("public/sw.js");
    const code = sw.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(code).not.toMatch(/caches\./);
    expect(code).toContain("u.origin === self.location.origin");
  });

  it("the worker is registered only when the family asks", () => {
    const card = read("app/halls/_components/DateAlertCard.tsx");
    const effect = card.slice(card.indexOf("useEffect("), card.indexOf("async function turnOn"));
    expect(effect).not.toContain("register(");
    expect(card).toContain('navigator.serviceWorker.register("/sw.js", { scope: "/" })');
  });

  it("the search page offers an alert only when it can work and a hall is hidden", () => {
    const page = read("app/halls/(browse)/page.tsx");
    expect(page).toContain("push && alertDate && dateChoice && bookedOnDate !== null && bookedOnDate > 0");
    expect(page).toContain("!(dateTo && dateTo > effectiveDate)");
    expect(page).toContain("effectiveDate >= todayInBusinessTz()");
  });

  it("the cron's GET does the work, on a minute no other sweep uses", () => {
    const route = read("app/api/admin/date-alerts/send/route.ts");
    expect(route).toMatch(/export async function GET[\s\S]*?return run\("cron"\)/);
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    expect(crons.find((c) => c.path === "/api/admin/date-alerts/send")?.schedule).toBe("2,12,22,32,42,52 * * * *");
  });

  it("the privacy policy names what is stored and who delivers it", () => {
    const privacy = read("app/(legal)/privacy/page.tsx");
    expect(privacy).toContain("<strong>Date alerts.</strong>");
    expect(privacy).toContain("your browser&apos;s push service");
  });
});
