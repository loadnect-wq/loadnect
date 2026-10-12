import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOwnerRow, MISSING_BUSINESS_NAME } from "../owner-row";
import { claimHallDraftSchema, hallCreateSchema } from "../validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// A new owner's first hall is one page (2026-10-12).
//
// Before: "Add your first hall" redirected a new owner to /owner/profile, with
// no explanation, to fill in Business Details. Its only required field was the
// business name, and the hall form was a separate trip back. Now the hall form
// asks for the name and createHall creates the hall_owners row from it.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A stand-in for the session client: one hall_owners table, records writes. */
function fakeDb(opts: {
  existing?: string | null;
  readError?: boolean;
  insertError?: { code: string; message: string };
  existsAfterRace?: string;
} = {}) {
  const inserts: unknown[] = [];
  let reads = 0;
  const db = {
    from(table: string) {
      expect(table).toBe("hall_owners");
      return {
        select() {
          return {
            eq(col: string) {
              expect(col).toBe("profile_id");
              return {
                maybeSingle: async () => {
                  reads += 1;
                  if (opts.readError) return { data: null, error: { message: "boom" } };
                  const id = reads > 1 && opts.existsAfterRace ? opts.existsAfterRace : opts.existing;
                  return { data: id ? { id } : null, error: null };
                },
              };
            },
          };
        },
        insert(row: unknown) {
          inserts.push(row);
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : { data: { id: "new-owner" }, error: null },
            }),
          };
        },
      };
    },
  };
  return { db, inserts };
}

describe("ensureOwnerRow", () => {
  it("returns an existing row untouched and ignores the name", async () => {
    const { db, inserts } = fakeDb({ existing: "owner-1" });
    expect(await ensureOwnerRow(db, "u1", "Anything")).toEqual({ id: "owner-1", created: false });
    expect(inserts).toEqual([]);
  });

  it("creates the row from the business name, with only the caller's id and that name", async () => {
    const { db, inserts } = fakeDb();
    expect(await ensureOwnerRow(db, "u1", "Sri Lakshmi Mahal")).toEqual({ id: "new-owner", created: true });
    expect(inserts).toEqual([{ profile_id: "u1", business_name: "Sri Lakshmi Mahal" }]);
  });

  it("never guesses a name: no row and no name is an error, and nothing is written", async () => {
    const { db, inserts } = fakeDb();
    expect(await ensureOwnerRow(db, "u1", undefined)).toEqual({ error: MISSING_BUSINESS_NAME });
    expect(inserts).toEqual([]);
  });

  it("treats a failed read as an error, not as 'no row'", async () => {
    const { db, inserts } = fakeDb({ readError: true });
    expect("error" in (await ensureOwnerRow(db, "u1", "Name"))).toBe(true);
    expect(inserts).toEqual([]);
  });

  it("a double submit that loses the race uses the winner's row", async () => {
    const { db } = fakeDb({ insertError: { code: "23505", message: "dup" }, existsAfterRace: "owner-9" });
    expect(await ensureOwnerRow(db, "u1", "Name")).toEqual({ id: "owner-9", created: false });
  });
});

describe("the create schema accepts a first-time owner", () => {
  const listing = {
    name: "Test Mahal", city: "Madurai", state: "Tamil Nadu", address: "", pincode: "",
    capacityMin: "", capacityMax: "400", pricePerDay: "", priceMorning: "", priceEvening: "",
    description: "", amenityIds: [], venueTypes: ["wedding"], bookingMode: "LEAD_GENERATION",
  };

  it("with no ownerId at all, and a business name", () => {
    const r = hallCreateSchema.safeParse({ ...listing, businessName: "  Sri Lakshmi Mahal " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.businessName).toBe("Sri Lakshmi Mahal");
  });

  it("rejects a one-letter business name", () => {
    expect(hallCreateSchema.safeParse({ ...listing, businessName: "A" }).success).toBe(false);
  });

  it("still accepts the existing-owner shape (an ownerId, no business name)", () => {
    const r = hallCreateSchema.safeParse({ ...listing, ownerId: "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b" });
    expect(r.success).toBe(true);
  });
});

describe("the flow", () => {
  it("createHall checks the role BEFORE it can create an owner row", () => {
    const src = code("app/owner/(dashboard)/actions.ts");
    const fn = src.slice(src.indexOf("export async function createHall"));
    const role = fn.indexOf('profileRow?.role !== "owner_approved"');
    const ensure = fn.indexOf("await ensureOwnerRow(db, user.id, v.businessName)");
    expect(role).toBeGreaterThan(0);
    expect(ensure).toBeGreaterThan(role);
    expect(fn.slice(0, ensure)).toContain("const db = supabase as any");
  });

  it("the new-hall page no longer redirects a first-time owner to Profile", () => {
    const page = code("app/owner/(dashboard)/halls/new/page.tsx");
    expect(page).not.toMatch(/redirect\(/);
    expect(page).toContain("needsBusinessName={!ownerRow}");
  });

  it("the first-time dashboard leads with adding a hall, or offers the waiting listing to claim right there", () => {
    const dash = code("app/owner/(dashboard)/dashboard/page.tsx");
    const first = dash.slice(dash.indexOf("if (!ownerRow) {"), dash.indexOf("const halls   = await fetchOwnerHalls"));
    expect(first).toContain('href="/owner/halls/new"');
    expect(first).toContain("await fetchClaimableDraft()");
    expect(first).not.toContain("Complete your business profile");
    // No detour for the claim either (0115): the card asks for the name.
    expect(first).toContain("<ClaimHallCard");
    expect(first).toContain("needsBusinessName");
    expect(first).not.toContain('href="/owner/profile"');
  });

  it("the form only sends a business name when it asked for one", () => {
    const form = code("app/owner/(dashboard)/halls/_components/HallForm.tsx");
    expect(form).toContain("businessName: needsBusinessName ? businessName : undefined");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Claiming a hall an admin prepared, as a first-time owner (0115).
// ─────────────────────────────────────────────────────────────────────────────

describe("0115: claim a prepared hall without a Profile visit", () => {
  const sql = read("supabase/migrations/0115_claim_draft_as_new_owner.sql");
  const fn = sql.slice(
    sql.indexOf("create or replace function public.claim_admin_hall_draft_as_new_owner"),
    sql.indexOf("$function$;"),
  ).replace(/--.*$/gm, ""); // code only: the comments name columns they do not write

  it("checks owner_approved BEFORE it can write, because it writes as SECURITY DEFINER", () => {
    expect(fn).toMatch(/security definer/);
    const role = fn.indexOf("v_profile.role::text <> 'owner_approved'");
    const insert = fn.indexOf("insert into public.hall_owners");
    expect(role).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(role);
  });

  it("writes only the caller's id and the name they typed, 2 to 160 characters, never verified", () => {
    expect(fn).toContain("values (v_uid, v_name)");
    expect(fn).toContain("insert into public.hall_owners (profile_id, business_name)");
    expect(fn).not.toMatch(/is_verified/);
    expect(fn).toContain("length(v_name) < 2");
    expect(fn).toContain("length(v_name) > 160");
    expect(fn).not.toMatch(/v_draft|admin_hall_drafts/); // never copies the hall's name
  });

  it("delegates every claim check to the untouched original, in the same transaction", () => {
    expect(fn).toContain("return public.claim_admin_hall_draft(_draft_id);");
    expect(sql).not.toMatch(/create or replace function public\.claim_admin_hall_draft\(/);
    expect(sql).not.toMatch(/drop function/i);
  });

  it("is callable by signed-in users only, and verifies itself", () => {
    expect(sql).toContain("revoke all on function public.claim_admin_hall_draft_as_new_owner(uuid, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.claim_admin_hall_draft_as_new_owner(uuid, text) to authenticated;");
    expect(sql).toContain("0115: the role check is missing");
    expect(sql).toContain("0115: claim_admin_hall_draft changed");
  });

  it("the action uses the wrapper only when a business name was sent", () => {
    const src = code("app/owner/(dashboard)/actions.ts");
    const action = src.slice(src.indexOf("export async function claimHallDraft"));
    expect(action).toMatch(/businessName\s*\?\s*await db\.rpc\("claim_admin_hall_draft_as_new_owner"/);
    expect(action).toContain('await db.rpc("claim_admin_hall_draft", { _draft_id: draftId })');
  });

  it("the schema takes an optional, trimmed business name", () => {
    const id = "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b";
    expect(claimHallDraftSchema.safeParse({ draftId: id }).success).toBe(true);
    const r = claimHallDraftSchema.safeParse({ draftId: id, businessName: " Ravi Halls " });
    expect(r.success && r.data.businessName).toBe("Ravi Halls");
    expect(claimHallDraftSchema.safeParse({ draftId: id, businessName: "R" }).success).toBe(false);
  });
});
