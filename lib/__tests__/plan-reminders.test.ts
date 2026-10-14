import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { planReminders, reminderMessage, REMINDER_LEAD_DAYS, type ReminderItem, type ReminderTask } from "../plan-reminders";
import { processPlanReminders } from "../plan-reminders.server";
import type { PushSender } from "../date-alerts.server";
import { planReminderSubscribeSchema } from "../validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Event plan reminders (0116, 2026-10-14). A morning phone notification when a
// payment or checklist task is due, and three days before a payment. The
// rules are pure; the sender is run here against an in-memory database.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const TODAY = "2026-10-14"; // a Wednesday
const SOON = "2026-10-17";  // TODAY + 3, a Saturday

const item = (over: Partial<ReminderItem>): ReminderItem => ({
  category: "catering", status: "booked", nextDueDate: null, nextDueAmount: null, ...over,
});
const task = (over: Partial<ReminderTask>): ReminderTask => ({
  title: "Book the photographer", dueDate: null, offsetDays: null, doneAt: null, ...over,
});

describe("what is due today", () => {
  it("a payment due today, and one due in three days", () => {
    expect(REMINDER_LEAD_DAYS).toBe(3);
    const r = planReminders({
      eventDate: "2026-12-01",
      items: [
        item({ category: "catering", nextDueDate: TODAY, nextDueAmount: 20000 }),
        item({ category: "decoration", nextDueDate: SOON, nextDueAmount: 150000 }),
      ],
      tasks: [],
      today: TODAY,
    });
    expect(r).toEqual([
      { kind: "payment-today", text: "Pay Catering ₹20,000 today" },
      { kind: "payment-soon", text: "Decoration ₹1,50,000 due Sat, 17 Oct" },
    ]);
  });

  it("a payment with no amount still reminds, without inventing one", () => {
    const r = planReminders({ eventDate: null, items: [item({ category: "music", nextDueDate: TODAY })], tasks: [], today: TODAY });
    expect(r[0].text).toBe("Music payment due today");
  });

  it("checklist tasks due today, by their own date or by days-before-the-function", () => {
    const r = planReminders({
      eventDate: "2026-11-13",
      items: [],
      tasks: [
        task({ title: "Send the invitations", dueDate: TODAY }),
        task({ title: "Book the photographer", offsetDays: 30 }), // 13 Nov − 30 days = 14 Oct
        task({ title: "Already done", dueDate: TODAY, doneAt: "2026-10-13T10:00:00Z" }),
      ],
      today: TODAY,
    });
    expect(r.map((x) => x.text)).toEqual(["Today: Send the invitations", "Today: Book the photographer"]);
  });

  it("is silent on a quiet day, for overdue items, for categories not needed, and after the function", () => {
    const quiet = { eventDate: "2026-12-01", tasks: [] as ReminderTask[], today: TODAY };
    expect(planReminders({ ...quiet, items: [item({ nextDueDate: "2026-10-20" })] })).toEqual([]);
    expect(planReminders({ ...quiet, items: [item({ nextDueDate: "2026-10-10" })] })).toEqual([]); // overdue: not repeated
    expect(planReminders({ ...quiet, items: [item({ status: "not_needed", nextDueDate: TODAY })] })).toEqual([]);
    expect(planReminders({ eventDate: "2026-10-01", items: [item({ nextDueDate: TODAY })], tasks: [], today: TODAY })).toEqual([]);
  });

  it("puts what is due today first", () => {
    const r = planReminders({
      eventDate: "2026-12-01",
      items: [item({ category: "makeup", nextDueDate: SOON }), item({ category: "catering", nextDueDate: TODAY })],
      tasks: [task({ dueDate: TODAY })],
      today: TODAY,
    });
    expect(r.map((x) => x.kind)).toEqual(["payment-today", "task-today", "payment-soon"]);
  });
});

describe("the notification", () => {
  const plan = { id: "p1", title: "Priya's wedding" };

  it("nothing to say is no notification", () => {
    expect(reminderMessage(plan, [], TODAY)).toBeNull();
  });

  it("names two reminders, counts the rest, opens the plan, and collapses repeats", () => {
    const m = reminderMessage(plan, [
      { kind: "payment-today", text: "Pay Catering ₹20,000 today" },
      { kind: "task-today", text: "Today: Send the invitations" },
      { kind: "task-today", text: "Today: Book the car" },
      { kind: "payment-soon", text: "Music payment due Sat, 17 Oct" },
    ], TODAY);
    expect(m).toEqual({
      title: "Priya's wedding",
      body: "Pay Catering ₹20,000 today · Today: Send the invitations · and 2 more",
      url: "/plan/p1",
      tag: `plan-reminder-p1-${TODAY}`,
    });
  });

  it("never names the vendor, only the category", () => {
    expect(read("lib/plan-reminders.ts")).not.toMatch(/vendorName|vendor_name|vendorPhone/);
    expect(read("lib/plan-reminders.server.ts")).not.toMatch(/vendor_name|vendor_phone/);
  });
});

// ── The sender, against an in-memory database ─────────────────────────────────

type Row = Record<string, unknown>;

class FakeDb {
  failOn: string | null = null;
  constructor(public tables: Record<string, Row[]>) {}
  from(t: string) { return new Q(this, t); }
}

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" | "delete" = "select";
  private values: Row = {};
  private returning = false;
  constructor(private db: FakeDb, private table: string) {}
  select(_c?: string) { if (this.op !== "select") this.returning = true; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  limit() { return this; }
  // Only the claim's shape: "last_sent_on.is.null,last_sent_on.neq.<date>".
  or(expr: string) {
    const day = expr.split("neq.")[1];
    this.filters.push((r) => r.last_sent_on == null || r.last_sent_on !== day);
    return this;
  }
  then<T>(resolve: (v: { data: unknown; error: { code: string; message: string } | null }) => T) {
    return Promise.resolve(this.exec()).then(resolve);
  }
  private exec() {
    if (this.db.failOn === this.table) return { data: null, error: { code: "XX", message: "boom" } };
    const rows = (this.db.tables[this.table] ??= []);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      match.forEach((r) => Object.assign(r, this.values));
      return { data: this.returning ? match.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !match.includes(r));
      return { data: null, error: null };
    }
    return { data: match.map((r) => ({ ...r })), error: null };
  }
}

const sub = (id: string, over: Row = {}): Row => ({
  id, plan_id: "p1", user_id: "owner", endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: "k", auth: "a", failure_count: 0, last_sent_on: null, ...over,
});

function world() {
  return new FakeDb({
    event_plan_reminder_subscriptions: [
      sub("s-owner"),
      sub("s-cousin", { user_id: "cousin" }),
      sub("s-removed", { user_id: "removed" }),
      sub("s-suspended", { user_id: "suspended" }),
      sub("s-quiet", { plan_id: "p2" }),
      sub("s-over", { plan_id: "p3" }),
    ],
    event_plans: [
      { id: "p1", title: "Priya's wedding", owner_id: "owner", event_date: "2026-12-01" },
      { id: "p2", title: "Quiet plan", owner_id: "owner", event_date: "2026-12-01" },
      { id: "p3", title: "Long over", owner_id: "owner", event_date: "2026-09-01" },
    ],
    event_plan_items: [
      { plan_id: "p1", category: "catering", status: "booked", next_due_date: TODAY, next_due_amount: "20000" },
    ],
    event_plan_tasks: [],
    event_plan_members: [
      { plan_id: "p1", user_id: "cousin" },
      { plan_id: "p1", user_id: "suspended" },
    ],
    profiles: [
      { id: "owner", is_active: true },
      { id: "cousin", is_active: true },
      { id: "removed", is_active: true },
      { id: "suspended", is_active: false },
    ],
  });
}

function recorder(fail: Record<string, number> = {}) {
  const calls: { endpoint: string; payload: Record<string, string> }[] = [];
  const send: PushSender = async (t, payload) => {
    if (fail[t.endpoint]) throw Object.assign(new Error("push failed"), { statusCode: fail[t.endpoint] });
    calls.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
  };
  return { calls, send };
}

const ids = (db: FakeDb) => db.tables.event_plan_reminder_subscriptions.map((r) => r.id);

describe("processPlanReminders", () => {
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("sends nothing at all without the VAPID pair", async () => {
    const s = await processPlanReminders({ db: world(), today: TODAY });
    expect(s.configured).toBe(false);
  });

  it("tells the owner and current family members once, and nobody who lost the plan", async () => {
    const db = world();
    const { calls, send } = recorder();
    const s = await processPlanReminders({ db, send, today: TODAY });

    expect(calls.map((c) => c.endpoint.split("/").pop()).sort()).toEqual(["s-cousin", "s-owner"]);
    expect(calls[0].payload).toMatchObject({ title: "Priya's wedding", body: "Pay Catering ₹20,000 today", url: "/plan/p1" });
    expect(s).toMatchObject({ sent: 2, quiet: 1 });
    // Removed from the family, or the function long over: their rows go.
    expect(ids(db)).not.toContain("s-removed");
    expect(ids(db)).not.toContain("s-over");
    // Suspended: kept (the account may be restored), but told nothing.
    expect(ids(db)).toContain("s-suspended");

    // The second morning run sends nothing again.
    const again = recorder();
    await processPlanReminders({ db, send: again.send, today: TODAY });
    expect(again.calls).toEqual([]);
  });

  it("deletes a phone that unsubscribed, and retries a transient failure on the next run", async () => {
    const db = world();
    const first = recorder({
      "https://fcm.googleapis.com/fcm/send/s-owner": 410,
      "https://fcm.googleapis.com/fcm/send/s-cousin": 503,
    });
    const s = await processPlanReminders({ db, send: first.send, today: TODAY });
    expect(s.failed).toBe(1);
    expect(ids(db)).not.toContain("s-owner");
    const cousin = db.tables.event_plan_reminder_subscriptions.find((r) => r.id === "s-cousin")!;
    expect(cousin).toMatchObject({ last_sent_on: null, failure_count: 1 });

    const second = recorder();
    await processPlanReminders({ db, send: second.send, today: TODAY });
    expect(second.calls.map((c) => c.endpoint.split("/").pop())).toEqual(["s-cousin"]);
  });

  it("fails closed: a failed membership read sends nothing and deletes nothing", async () => {
    const db = world();
    db.failOn = "event_plan_members";
    const { calls, send } = recorder();
    const s = await processPlanReminders({ db, send, today: TODAY });
    expect(calls).toEqual([]);
    expect(s.errors).toBe(1);
    expect(ids(db)).toHaveLength(6);
  });
});

describe("the wiring", () => {
  it("the table is server-only and verifies itself", () => {
    const sql = read("supabase/migrations/0116_plan_reminders.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.event_plan_reminder_subscriptions from anon, authenticated;");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("unique (plan_id, user_id, endpoint)");
    expect(sql).toMatch(/do \$verify\$/);
  });

  it("a phone address must be a known push service", () => {
    const base = { planId: "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b", p256dh: "B".repeat(87), auth: "A".repeat(22) };
    expect(planReminderSubscribeSchema.safeParse({ ...base, endpoint: "https://fcm.googleapis.com/fcm/send/abc123" }).success).toBe(true);
    expect(planReminderSubscribeSchema.safeParse({ ...base, endpoint: "https://evil.example/push" }).success).toBe(false);
  });

  it("subscribing checks plan access with the caller's own session before writing", () => {
    const src = read("lib/plan-reminders.server.ts");
    const save = src.slice(src.indexOf("export async function savePlanReminder"), src.indexOf("export async function removePlanReminder"));
    const access = save.indexOf('input.sessionDb\n    .from("event_plans")');
    const write = save.indexOf("getSupabaseAdminClient()");
    expect(access).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(access);
    expect(read("app/plan/reminder-actions.ts")).toContain("sessionDb: await getSupabaseServerClient()");
  });

  it("runs every morning, twice, on a minute no other job uses", () => {
    const cron = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    const mine = cron.find((c) => c.path === "/api/admin/plan-reminders/send");
    expect(mine?.schedule).toBe("45 3,5 * * *");
    const minutes = cron.filter((c) => c !== mine).flatMap((c) => c.schedule.split(" ")[0].split(","));
    expect(minutes).not.toContain("45");
    expect(read("app/api/admin/plan-reminders/send/route.ts")).toMatch(/export async function GET[\s\S]*hasValidCronSecret/);
  });

  it("the page gets only the public half of the key pair", () => {
    const page = read("app/plan/[id]/page.tsx");
    expect(page).toContain("pushConfig()?.publicKey");
    expect(page).not.toMatch(/privateKey/);
  });
});
