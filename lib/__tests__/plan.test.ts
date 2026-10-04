import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CATEGORIES,
  MAX_PLANS,
  PLAN_CATEGORY_KEYS,
  TEMPLATE_TASKS,
  countdownLabel,
  offsetLabel,
  paidInFull,
  planTotals,
  taskDueDate,
  templateFor,
  type PlanItemAmounts,
} from "../plan";
import { planDetailsSchema, planItemSchema, planTaskSchema } from "../validation/schemas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── An in-memory session client, just enough for lib/plan.server ─────────────

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failInsert: string | null = null;
let seq = 0;

class Q {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private values: Row | Row[] = {};
  private head = false;
  private returning = false;
  private one = false;
  constructor(private table: string) {}
  select(_c?: string, o?: { head?: boolean }) { if (this.op === "select") this.head = Boolean(o?.head); else this.returning = true; return this; }
  insert(v: Row | Row[]) { this.op = "insert"; this.values = v; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  then<T>(res: (v: { data: unknown; error: { code: string; message: string } | null; count?: number }) => T) {
    return Promise.resolve(this.run()).then(res);
  }
  private run() {
    const rows = (tables[this.table] ??= []);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      if (failInsert === this.table) return { data: null, error: { code: "XX000", message: "boom" } };
      const list = (Array.isArray(this.values) ? this.values : [this.values]).map((v) => ({ id: `${this.table}-${++seq}`, ...v }));
      rows.push(...list);
      return { data: this.one ? { id: list[0].id } : list, error: null };
    }
    if (this.op === "update") {
      match.forEach((r) => Object.assign(r, this.values));
      return { data: this.returning ? match : null, error: null };
    }
    if (this.op === "delete") {
      tables[this.table] = rows.filter((r) => !match.includes(r));
      if (this.table === "event_plans") {
        const gone = new Set(match.map((r) => r.id));
        for (const t of ["event_plan_items", "event_plan_tasks"]) tables[t] = (tables[t] ?? []).filter((r) => !gone.has(r.plan_id));
      }
      return { data: this.returning ? match : null, error: null };
    }
    if (this.head) return { data: null, error: null, count: match.length };
    return { data: this.one ? (match[0] ?? null) : match, error: null };
  }
}

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ from: (t: string) => new Q(t) }) }));

const { createPlan, updateItem, setItemNeeded } = await import("../plan.server");

const OWNER = "11111111-1111-4111-8111-111111111111";
const details = { title: "Priya's wedding", occasion: "wedding", eventDate: "2027-02-10", city: "Madurai", guests: 400, budget: 1500000 };

// ── Rules ────────────────────────────────────────────────────────────────────

describe("templates", () => {
  it("maps occasions to the right checklist", () => {
    expect(templateFor("wedding")).toBe("wedding");
    expect(templateFor("reception")).toBe("celebration");
    expect(templateFor("birthday-party")).toBe("celebration");
    expect(templateFor("meeting")).toBe("work");
    expect(templateFor("something-new")).toBe("work");
  });

  it("uses only real categories, permanent unique keys and sane offsets", () => {
    for (const [name, tasks] of Object.entries(TEMPLATE_TASKS)) {
      const keys = tasks.map((t) => t.key);
      expect(new Set(keys).size, name).toBe(keys.length);
      for (const t of tasks) {
        expect(t.key.length).toBeLessThanOrEqual(60);
        expect(t.title.length).toBeLessThanOrEqual(140);
        expect(t.offsetDays).toBeGreaterThanOrEqual(0);
        expect(t.offsetDays).toBeLessThanOrEqual(730);
        if (t.category) expect(PLAN_CATEGORY_KEYS).toContain(t.category);
      }
    }
    for (const cats of Object.values(DEFAULT_CATEGORIES)) for (const c of cats) expect(PLAN_CATEGORY_KEYS).toContain(c);
    expect(DEFAULT_CATEGORIES.work).toContain("hall");
  });
});

describe("dates", () => {
  it("works out due dates from the function's date, or keeps a task's own", () => {
    expect(taskDueDate({ dueDate: null, offsetDays: 240 }, "2027-02-10")).toBe("2026-06-15");
    expect(taskDueDate({ dueDate: "2026-12-01", offsetDays: 240 }, "2027-02-10")).toBe("2026-12-01");
    expect(taskDueDate({ dueDate: null, offsetDays: 30 }, null)).toBeNull();
  });

  it("says how long before, and how long until", () => {
    expect(offsetLabel(270)).toBe("9 months before");
    expect(offsetLabel(21)).toBe("3 weeks before");
    expect(offsetLabel(7)).toBe("7 days before");
    expect(offsetLabel(1)).toBe("1 day before");
    expect(countdownLabel("2026-10-14", "2026-10-04")).toBe("in 10 days");
    expect(countdownLabel("2026-10-05", "2026-10-04")).toBe("tomorrow");
    expect(countdownLabel("2026-10-04", "2026-10-04")).toBe("today");
    expect(countdownLabel("2026-10-01", "2026-10-04")).toBe("already held");
    expect(countdownLabel(null, "2026-10-04")).toBe("Date not fixed yet");
  });
});

describe("money", () => {
  const item = (o: Partial<PlanItemAmounts>): PlanItemAmounts => ({ status: "todo", plannedAmount: null, quotedAmount: null, paidAmount: null, ...o });

  it("adds booked prices, planned amounts still to book, payments and what is owed", () => {
    const t = planTotals([
      item({ status: "booked", quotedAmount: 160000, paidAmount: 40000 }),
      item({ status: "booked", plannedAmount: 50000 }),            // booked without a quote: planned stands in
      item({ status: "asked", plannedAmount: 300000, quotedAmount: 320000 }), // not booked: planned counts
      item({ status: "todo", quotedAmount: 25000 }),               // only a quote: it counts
      item({ status: "not_needed", plannedAmount: 99999 }),        // ignored
    ], 600000);
    expect(t).toMatchObject({ booked: 210000, toBook: 325000, expected: 535000, paid: 40000, stillToPay: 170000, left: 65000, activeCount: 4, bookedCount: 2 });
    expect(planTotals([item({ status: "booked", quotedAmount: 700000 })], 600000).left).toBe(-100000);
    expect(planTotals([], null).left).toBeNull();
  });

  it("calls an item paid in full only when it is booked and the agreed price is paid", () => {
    expect(paidInFull(item({ status: "booked", quotedAmount: 1000, paidAmount: 1000 }))).toBe(true);
    expect(paidInFull(item({ status: "booked", quotedAmount: 1000, paidAmount: 999 }))).toBe(false);
    expect(paidInFull(item({ status: "asked", quotedAmount: 1000, paidAmount: 1000 }))).toBe(false);
    expect(paidInFull(item({ status: "booked" }))).toBe(false);
  });
});

describe("validation", () => {
  it("reads amounts the way they are typed", () => {
    const d = planDetailsSchema.parse({ title: " Wedding ", occasion: "wedding", eventDate: "", city: "", guests: "400", budget: "₹ 15,00,000" });
    expect(d).toMatchObject({ title: "Wedding", eventDate: undefined, guests: 400, budget: 1500000 });
    expect(planDetailsSchema.safeParse({ title: "x", occasion: "wedding", budget: "abc" }).success).toBe(false);
    expect(planDetailsSchema.safeParse({ title: "x", occasion: "Wedding!" }).success).toBe(false);
    expect(planDetailsSchema.safeParse({ title: "", occasion: "wedding" }).success).toBe(false);
  });

  it("checks items and tasks", () => {
    const base = { planId: OWNER, category: "hall", status: "booked" };
    expect(planItemSchema.parse({ ...base, hallId: "", paidAmount: "40,000" })).toMatchObject({ hallId: undefined, paidAmount: 40000 });
    expect(planItemSchema.safeParse({ ...base, category: "fireworks" }).success).toBe(false);
    expect(planItemSchema.safeParse({ ...base, status: "maybe" }).success).toBe(false);
    expect(planItemSchema.safeParse({ ...base, vendorPhone: "call me" }).success).toBe(false);
    expect(planTaskSchema.parse({ planId: OWNER, title: "Buy flowers", dueDate: "", category: "" })).toMatchObject({ dueDate: undefined, category: undefined });
  });
});

// ── The server half ──────────────────────────────────────────────────────────

describe("creating and editing a plan", () => {
  beforeEach(() => {
    tables = {};
    failInsert = null;
  });

  it("creates the whole board and the occasion's checklist", async () => {
    const res = await createPlan(OWNER, details);
    expect(res.ok).toBe(true);
    expect(tables.event_plan_items).toHaveLength(PLAN_CATEGORY_KEYS.length);
    expect(tables.event_plan_items.every((i) => i.status === "todo")).toBe(true); // a wedding uses every category
    expect(tables.event_plan_tasks.map((t) => t.template_key)).toEqual(TEMPLATE_TASKS.wedding.map((t) => t.key));

    tables = {};
    await createPlan(OWNER, { ...details, occasion: "meeting" });
    const on = tables.event_plan_items.filter((i) => i.status === "todo").map((i) => i.category);
    expect(on.sort()).toEqual([...DEFAULT_CATEGORIES.work].sort());
  });

  it("removes a half-made plan instead of leaving it without a board", async () => {
    failInsert = "event_plan_items";
    const res = await createPlan(OWNER, details);
    expect(res.ok).toBe(false);
    expect(tables.event_plans ?? []).toHaveLength(0);
  });

  it(`stops at ${MAX_PLANS} plans`, async () => {
    tables.event_plans = Array.from({ length: MAX_PLANS }, (_, i) => ({ id: `p${i}`, owner_id: OWNER }));
    const res = await createPlan(OWNER, details);
    expect(res.ok).toBe(false);
  });

  it("keeps a hall id on the hall item only", async () => {
    await createPlan(OWNER, details);
    const planId = String(tables.event_plans[0].id);
    const f = { status: "booked" as const, hallId: "fda1a579-57b5-4def-acc4-ee27b060a67f", vendorName: null, vendorPhone: null, notes: null,
      plannedAmount: null, quotedAmount: 160000, paidAmount: 40000, nextDueDate: null, nextDueAmount: null };
    await updateItem(planId, "catering", f);
    await updateItem(planId, "hall", f);
    const byCat = Object.fromEntries(tables.event_plan_items.map((i) => [i.category, i]));
    expect(byCat.catering.hall_id).toBeNull();
    expect(byCat.hall.hall_id).toBe(f.hallId);
    expect(await updateItem("no-such-plan", "hall", f)).toEqual({ ok: false, error: "Plan not found." });
  });

  it("switching a category on revives it, never resets one in progress", async () => {
    await createPlan(OWNER, { ...details, occasion: "meeting" });
    const planId = String(tables.event_plans[0].id);
    const music = () => tables.event_plan_items.find((i) => i.category === "music")!;
    const hall = () => tables.event_plan_items.find((i) => i.category === "hall")!;
    expect(music().status).toBe("not_needed");
    await setItemNeeded(planId, "music", true);
    expect(music().status).toBe("todo");
    hall().status = "booked";
    await setItemNeeded(planId, "hall", true);
    expect(hall().status).toBe("booked");
  });
});

// ── Guard rails ──────────────────────────────────────────────────────────────

describe("guard rails", () => {
  const migration = read("supabase/migrations/0110_event_plans.sql");

  it("keeps plans private: no admin reads, owner_id cannot be rewritten, access in one function", () => {
    expect(migration).not.toMatch(/is_admin\(\)/);
    expect(migration).toContain("grant update (title, occasion, event_date, city, guests, budget) on public.event_plans to authenticated;");
    expect(migration).toContain("create or replace function public.plan_access(_plan uuid)");
    expect(migration).toContain("for select using (owner_id = auth.uid() or public.plan_access(id) is not null);");
  });

  it("reads and writes through the session, never the service role", () => {
    const server = read("lib/plan.server.ts");
    expect(server).toContain("getSupabaseServerClient");
    expect(server).not.toContain("getSupabaseAdminClient");
  });

  it("closing an account deletes plans and site visit requests", () => {
    const del = read("lib/account-deletion.ts");
    expect(del).toContain('["event_plans", "owner_id"]');
    expect(del).toContain('["site_visits", "customer_id"]');
    expect(read("app/(legal)/privacy/page.tsx")).toContain("event plans and site visit requests are permanently removed");
  });

  it("every sign-in return path the app uses is allowed by both allow-lists", () => {
    const login = read("app/(auth)/login/page.tsx");
    const callback = read("app/auth/callback/route.ts");
    const loginList = JSON.parse(/const ALLOWED_NEXT_PREFIXES = (\[[^\]]+\]);/.exec(login)![1]) as string[];
    const callbackList = [...callback.slice(callback.indexOf("const ALLOWED_REDIRECT_PREFIXES"), callback.indexOf("];")).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir)).flatMap((f) => {
        const p = `${dir}/${f}`;
        return statSync(join(root, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
      });
    const used = new Set<string>();
    for (const f of [...walk("app"), ...walk("components")]) {
      // Code only: comments quote paths that are deliberately refused.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const m of code.matchAll(/\/login\?next=(\/[a-z-]+\/?)/g)) used.add(m[1]);
    }
    expect([...used].sort()).toEqual(expect.arrayContaining(["/booking/", "/plan/", "/verify-phone", "/visit/"]));
    for (const path of used) {
      expect(loginList.some((p) => path.startsWith(p)), `login allows ${path}`).toBe(true);
      expect(callbackList.some((p) => path.startsWith(p)), `callback allows ${path}`).toBe(true);
    }
  });
});
