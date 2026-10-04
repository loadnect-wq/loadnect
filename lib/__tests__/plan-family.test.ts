import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVITE_TOKEN_PATTERN,
  MAX_OPTIONS,
  canEdit,
  invitePath,
  leadingOption,
  personName,
  planSummaryText,
  planTotals,
  votersByOption,
  type PlanSummaryInput,
} from "../plan";
import { planInviteTokenSchema, planOptionSchema, planVoteSchema } from "../validation/schemas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── A recording session client, just enough for lib/plan-family.server ───────

type Call = { table?: string; rpc?: string; op: string; values?: unknown; filters: Record<string, unknown>; opts?: unknown; args?: unknown };
type Reply = { data?: unknown; error?: { code: string; message: string } | null; count?: number };
let calls: Call[] = [];
let reply: (c: Call) => Reply = () => ({ data: null, error: null });

class Q {
  private c: Call;
  constructor(table: string) { this.c = { table, op: "select", filters: {} }; }
  select(_cols?: string, o?: { head?: boolean }) { if (this.c.op === "select" && o?.head) this.c.op = "count"; return this; }
  insert(v: unknown) { this.c.op = "insert"; this.c.values = v; return this; }
  upsert(v: unknown, opts?: unknown) { this.c.op = "upsert"; this.c.values = v; this.c.opts = opts; return this; }
  update(v: unknown) { this.c.op = "update"; this.c.values = v; return this; }
  delete() { this.c.op = "delete"; return this; }
  eq(col: string, v: unknown) { this.c.filters[col] = v; return this; }
  order() { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  then<T>(res: (v: Reply) => T) {
    calls.push(this.c);
    return Promise.resolve({ data: null, error: null, ...reply(this.c) }).then(res);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    from: (t: string) => new Q(t),
    rpc: (name: string, args: unknown) => {
      const c: Call = { rpc: name, op: "rpc", filters: {}, args };
      calls.push(c);
      return Promise.resolve({ data: null, error: null, ...reply(c) });
    },
  }),
}));

const fam = await import("../plan-family.server");

const PLAN = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const OPT = "33333333-3333-4333-8333-333333333333";
const HALL = "fda1a579-57b5-4def-acc4-ee27b060a67f";

beforeEach(() => {
  calls = [];
  reply = () => ({ data: null, error: null });
});

// ── Rules ────────────────────────────────────────────────────────────────────

describe("roles and names", () => {
  it("lets owners and editors change things, and nobody else", () => {
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(canEdit(null)).toBe(false);
  });

  it("never shows a blank name", () => {
    expect(personName("  Lakshmi ")).toBe("Lakshmi");
    expect(personName(null)).toBe("A family member");
    expect(personName("   ")).toBe("A family member");
  });

  it("makes invite tokens the database accepts, and refuses anything else", () => {
    const token = randomBytes(16).toString("base64url");
    expect(token).toMatch(INVITE_TOKEN_PATTERN);
    expect(invitePath(token)).toBe(`/plan/join/${token}`);
    expect(planInviteTokenSchema.safeParse(token).success).toBe(true);
    expect(planInviteTokenSchema.safeParse("short").success).toBe(false);
    expect(planInviteTokenSchema.safeParse("../../etc/passwd-aaaaaaaaaaaa").success).toBe(false);
    // The same rule as the table's check constraint.
    expect(read("supabase/migrations/0111_event_plan_sharing.sql")).toContain("check (token ~ '^[A-Za-z0-9_-]{22,64}$')");
  });
});

describe("votes", () => {
  const opts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("counts voters per option", () => {
    const v = votersByOption([{ optionId: "a", userId: "u1" }, { optionId: "a", userId: "u2" }, { optionId: "b", userId: "u3" }]);
    expect(v.get("a")).toEqual(["u1", "u2"]);
    expect(v.get("b")).toEqual(["u3"]);
    expect(v.get("c")).toBeUndefined();
  });

  it("names a leader only when one option is clearly ahead", () => {
    expect(leadingOption(opts, [])).toBeNull();
    expect(leadingOption(opts, [{ optionId: "a", userId: "u1" }, { optionId: "b", userId: "u2" }])).toBeNull(); // a tie
    expect(leadingOption(opts, [{ optionId: "b", userId: "u1" }, { optionId: "b", userId: "u2" }, { optionId: "a", userId: "u3" }]))
      .toEqual({ option: { id: "b" }, votes: 2 });
  });
});

describe("the WhatsApp summary", () => {
  const base: PlanSummaryInput = {
    title: "Priya's wedding",
    occasionName: "Wedding",
    eventDate: "2027-02-10",
    today: "2026-10-04",
    city: "Madurai",
    guests: 400,
    items: [
      { category: "hall", status: "booked", chosen: "Sri Mahal" },
      { category: "catering", status: "asked", chosen: null },
      { category: "music", status: "not_needed", chosen: null },
    ],
    totals: planTotals([
      { status: "booked", plannedAmount: null, quotedAmount: 285000, paidAmount: 100000 },
      { status: "asked", plannedAmount: 280000, quotedAmount: null, paidAmount: null },
    ], 900000),
    budget: 900000,
    tasksDone: 4,
    tasksTotal: 17,
    leaders: [{ category: "catering", name: "Annapoorna", votes: 3 }],
  };

  it("says what is booked, what is left, how the vote stands and where the money is", () => {
    const text = planSummaryText(base);
    expect(text.split("\n")).toEqual([
      "*Priya's wedding*",
      "Wedding · 10 Feb 2027 (in 129 days)",
      "Madurai · 400 guests",
      "",
      "Booked: Hall (Sri Mahal)",
      "Still to arrange: Catering",
      "Family vote, catering: Annapoorna leads with 3 votes",
      "",
      "Budget ₹9,00,000, expected ₹5,65,000, paid ₹1,00,000.",
      "Checklist: 4 of 17 done.",
      "",
      "The plan on Hallnect:",
    ]);
    expect(text).not.toContain("Music"); // not needed is not news
  });

  it("copes with a plan that has no date, money or board yet", () => {
    const text = planSummaryText({
      ...base, eventDate: null, city: null, guests: null, items: [], budget: null, tasksDone: 0, tasksTotal: 0, leaders: [],
      totals: planTotals([], null),
    });
    expect(text).toBe("*Priya's wedding*\nWedding · Date not fixed yet\n\nNothing on the board yet.\n\nThe plan on Hallnect:");
  });
});

describe("validation", () => {
  it("takes a hall by id on the hall only, and anything else by name", () => {
    expect(planOptionSchema.parse({ planId: PLAN, category: "hall", hallId: HALL, price: "1,50,000" }))
      .toMatchObject({ hallId: HALL, name: "", price: 150000 });
    expect(planOptionSchema.safeParse({ planId: PLAN, category: "catering", hallId: HALL, name: "X" }).success).toBe(false);
    expect(planOptionSchema.safeParse({ planId: PLAN, category: "catering", name: "  " }).success).toBe(false);
    const named = planOptionSchema.parse({ planId: PLAN, category: "catering", hallId: "", name: " Annapoorna ", note: "Veg, 2 meals" });
    expect(named).toMatchObject({ name: "Annapoorna", note: "Veg, 2 meals" });
    expect(named.hallId).toBeUndefined();
  });

  it("reads an empty vote as taking it back", () => {
    expect(planVoteSchema.parse({ planId: PLAN, category: "catering", optionId: "" })).toMatchObject({ optionId: undefined });
    expect(planVoteSchema.safeParse({ planId: PLAN, category: "fireworks", optionId: OPT }).success).toBe(false);
  });
});

// ── The server half ──────────────────────────────────────────────────────────

describe("sharing", () => {
  it("makes an invite once, without replacing a link someone may have copied", async () => {
    reply = (c) => (c.table === "event_plan_invites" && c.op === "select" ? { data: { token: "Tok_abcdefghijklmnopqrstuv" } } : {});
    const res = await fam.createInvite(PLAN);
    expect(res).toEqual({ ok: true, token: "Tok_abcdefghijklmnopqrstuv" });
    const up = calls.find((c) => c.op === "upsert")!;
    expect((up.values as { token: string }).token).toMatch(INVITE_TOKEN_PATTERN);
    expect(up.opts).toEqual({ onConflict: "plan_id", ignoreDuplicates: true });
  });

  it("tells an editor that only the owner invites", async () => {
    reply = (c) => (c.op === "upsert" ? { error: { code: "42501", message: "rls" } } : {});
    expect(await fam.createInvite(PLAN)).toEqual({ ok: false, error: "Only the person who started the plan can do that." });
    reply = () => ({}); // the insert did nothing and the link cannot be read: not the owner
    expect((await fam.createInvite(PLAN)).ok).toBe(false);
  });

  it("turns each join outcome into somewhere to go or something to say", async () => {
    for (const outcome of ["joined", "member", "owner"]) {
      reply = () => ({ data: { outcome, plan: PLAN } });
      expect(await fam.joinPlan("Tok_abcdefghijklmnopqrstuv")).toEqual({ ok: true, planId: PLAN });
    }
    reply = () => ({ data: { outcome: "invalid" } });
    expect(await fam.joinPlan("Tok_abcdefghijklmnopqrstuv")).toEqual({ ok: false, error: "This invite link has been turned off. Ask for a new one." });
    reply = () => ({ data: { outcome: "full" } });
    expect((await fam.joinPlan("Tok_abcdefghijklmnopqrstuv")).ok).toBe(false);
    expect(calls.every((c) => c.rpc === "join_event_plan")).toBe(true);
  });

  it("reads a dead invite as no invite, and a failed read as a failure", async () => {
    reply = () => ({ data: null });
    expect(await fam.previewInvite("Tok_abcdefghijklmnopqrstuv")).toEqual({ ok: true, invite: null });
    reply = () => ({ error: { code: "XX000", message: "boom" } });
    expect(await fam.previewInvite("Tok_abcdefghijklmnopqrstuv")).toEqual({ ok: false });
  });
});

describe("options and votes", () => {
  it(`stops at ${MAX_OPTIONS} options in a category`, async () => {
    reply = (c) => (c.op === "count" ? { count: MAX_OPTIONS } : {});
    const res = await fam.addOption(PLAN, { category: "catering", hallId: null, name: "X", price: null, note: null });
    expect(res.ok).toBe(false);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("keeps a hall id off every category but the hall, and says when a hall is already listed", async () => {
    reply = (c) => (c.op === "count" ? { count: 0 } : {});
    await fam.addOption(PLAN, { category: "catering", hallId: HALL, name: "X", price: 1, note: null });
    expect((calls.find((c) => c.op === "insert")!.values as { hall_id: unknown }).hall_id).toBeNull();
    reply = (c) => (c.op === "count" ? { count: 0 } : c.op === "insert" ? { error: { code: "23505", message: "dup" } } : {});
    expect(await fam.addOption(PLAN, { category: "hall", hallId: HALL, name: "Sri Mahal", price: null, note: null }))
      .toEqual({ ok: false, error: "That hall is already on the list." });
  });

  it("casts the caller's own vote, one per category, and explains a stale option", async () => {
    await fam.castVote(PLAN, "catering", OPT, ME);
    const up = calls.find((c) => c.op === "upsert")!;
    expect(up.values).toMatchObject({ plan_id: PLAN, category: "catering", user_id: ME, option_id: OPT });
    expect(up.opts).toEqual({ onConflict: "plan_id,category,user_id" });
    reply = () => ({ error: { code: "23503", message: "fk" } });
    expect(await fam.castVote(PLAN, "catering", OPT, ME)).toEqual({ ok: false, error: "That option is not on the list any more." });
  });

  it("choosing a hall puts it on the board, clears a typed name and only moves progress forward", async () => {
    let patch: Record<string, unknown> = {};
    const run = async (option: Record<string, unknown>, item: Record<string, unknown>) => {
      reply = (c) => {
        if (c.table === "event_plan_options") return { data: option };
        if (c.table === "event_plan_items" && c.op === "select") return { data: item };
        if (c.op === "update") { patch = c.values as Record<string, unknown>; return { data: [{ id: "i" }] }; }
        return {};
      };
      return fam.chooseOption(PLAN, OPT);
    };
    expect(await run({ id: OPT, category: "hall", hall_id: HALL, name: "Sri Mahal", price: 285000, note: null },
      { status: "todo", hall_id: null, vendor_name: "Some hall" })).toEqual({ ok: true });
    expect(patch).toEqual({ hall_id: HALL, vendor_name: null, vendor_phone: null, quoted_amount: 285000, status: "shortlisted" });

    await run({ id: OPT, category: "catering", hall_id: null, name: "Annapoorna", price: null, note: null },
      { status: "booked", hall_id: null, vendor_name: "Annapoorna" });
    expect(patch).toEqual({ vendor_name: "Annapoorna" }); // same vendor: phone kept; booked stays booked; no price, no quote change

    await run({ id: OPT, category: "catering", hall_id: null, name: "Lakshmi Caterers", price: 120000, note: null },
      { status: "asked", hall_id: null, vendor_name: "Annapoorna" });
    expect(patch).toEqual({ vendor_name: "Lakshmi Caterers", vendor_phone: null, quoted_amount: 120000 });
  });

  it("tells a viewer they cannot choose", async () => {
    reply = (c) => {
      if (c.table === "event_plan_options") return { data: { id: OPT, category: "catering", hall_id: null, name: "X", price: null, note: null } };
      if (c.table === "event_plan_items" && c.op === "select") return { data: { status: "todo", hall_id: null, vendor_name: null } };
      if (c.op === "update") return { data: [] };
      return {};
    };
    expect(await fam.chooseOption(PLAN, OPT)).toEqual({ ok: false, error: "Only people who can edit the plan can choose." });
  });
});

// ── Guard rails ──────────────────────────────────────────────────────────────

describe("guard rails", () => {
  const sql = read("supabase/migrations/0111_event_plan_sharing.sql");

  it("keeps plans away from admins and from anyone signed out", () => {
    expect(sql).not.toMatch(/is_admin\(\)/);
    for (const fn of ["join_event_plan(text)", "event_plan_invite_preview(text)", "event_plan_people(uuid)"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated, service_role;`);
    }
  });

  it("lets nobody add a member but the join function, and only the owner see the link", () => {
    expect(sql).toContain("grant select, delete on public.event_plan_members to authenticated;");
    expect(sql).toContain("grant update (role) on public.event_plan_members to authenticated;");
    expect(sql).not.toMatch(/create policy \w+ on public\.event_plan_members\s+for (insert|all)/);
    expect(sql).toMatch(/create policy event_plan_invites_owner on public\.event_plan_invites\s+for all using \(public\.plan_access\(plan_id\) = 'owner'\)/);
  });

  it("never lets a vote change hands or an option change its hall", () => {
    expect(sql).toContain("for all using (user_id = auth.uid() and public.plan_access(plan_id) is not null)");
    expect(sql).toContain("grant update (name, price, note) on public.event_plan_options to authenticated;");
    expect(sql).toContain("references public.event_plan_options (id, plan_id, category) on delete cascade");
  });

  it("answers members through plan_access, and stops suspended accounts writing to every plan table", () => {
    expect(sql).toContain("from public.event_plan_members m where m.plan_id = _plan and m.user_id = auth.uid()");
    for (const t of ["event_plans", "event_plan_items", "event_plan_tasks", "event_plan_members", "event_plan_invites", "event_plan_options", "event_plan_votes"]) {
      expect(sql).toContain(`'${t}'`);
    }
    expect(sql).toContain("as restrictive for insert to authenticated");
  });

  it("reads and writes through the session, never the service role", () => {
    const server = read("lib/plan-family.server.ts");
    expect(server).toContain("getSupabaseServerClient");
    expect(server).not.toContain("getSupabaseAdminClient");
  });

  it("closing an account removes its place and votes in other people's plans, and the policy says so", () => {
    const del = read("lib/account-deletion.ts");
    expect(del).toContain('["event_plan_members", "user_id"]');
    expect(del).toContain('["event_plan_votes", "user_id"]');
    const privacy = read("app/(legal)/privacy/page.tsx");
    expect(privacy).toContain("your place and votes in plans others shared with you");
    expect(privacy).toContain("only if you share an event plan or join one");
  });

  it("keeps the invite token out of analytics", () => {
    expect(read("lib/analytics/redact-url.ts")).toContain('["plan", "join"]');
  });
});
