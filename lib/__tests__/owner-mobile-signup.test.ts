import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeCustomerToOwner } from "../auth/owner-upgrade";

// ─────────────────────────────────────────────────────────────────────────────
// Owner sign-up by mobile (2026-10-11). /owner/register was Google only,
// because owner intent was applied only in the OAuth callback and a mobile
// sign-up never passes through it — it would have made a customer. Now both
// doors share one rule, lib/auth/owner-upgrade.ts, applied only inside a
// sign-in the person has just completed: customer → owner_approved, nothing
// else.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A stand-in for the service-role client: records every update it is asked for. */
function fakeAdmin(role: string | null, opts: { readError?: boolean; updateError?: boolean } = {}) {
  const updates: { values: unknown; filters: [string, unknown][] }[] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe("profiles");
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () =>
                  opts.readError ? { data: null, error: { message: "boom" } } : { data: role === null ? null : { role }, error: null },
              };
            },
          };
        },
        update(values: unknown) {
          const entry = { values, filters: [] as [string, unknown][] };
          updates.push(entry);
          const chain = {
            eq(col: string, val: unknown) {
              entry.filters.push([col, val]);
              return chain;
            },
            then(resolve: (v: { error: unknown }) => void) {
              resolve({ error: opts.updateError ? { message: "boom" } : null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { admin, updates };
}

describe("upgradeCustomerToOwner: customer → owner_approved, and nothing else", () => {
  it("upgrades a customer, and the write itself only matches a customer", async () => {
    const { admin, updates } = fakeAdmin("customer");
    expect(await upgradeCustomerToOwner(admin, "u1")).toBe(true);
    expect(updates).toEqual([{ values: { role: "owner_approved" }, filters: [["id", "u1"], ["role", "customer"]] }]);
  });

  it("leaves an owner or an admin exactly as they are", async () => {
    for (const role of ["owner_approved", "admin"]) {
      const { admin, updates } = fakeAdmin(role);
      expect(await upgradeCustomerToOwner(admin, "u1"), role).toBe(true);
      expect(updates, role).toEqual([]);
    }
  });

  it("does nothing for a missing profile or an unknown role", async () => {
    for (const role of [null, "owner_pending", "something_else"]) {
      const { admin, updates } = fakeAdmin(role);
      expect(await upgradeCustomerToOwner(admin, "u1"), String(role)).toBe(false);
      expect(updates, String(role)).toEqual([]);
    }
  });

  it("reports failure rather than pretending, on a failed read or write", async () => {
    const read = fakeAdmin("customer", { readError: true });
    expect(await upgradeCustomerToOwner(read.admin, "u1")).toBe(false);
    expect(read.updates).toEqual([]);
    const write = fakeAdmin("customer", { updateError: true });
    expect(await upgradeCustomerToOwner(write.admin, "u1")).toBe(false);
  });
});

describe("the mobile door: only after the code is approved and the session exists", () => {
  const src = code("app/(auth)/login/phone-actions.ts");
  const verify = src.slice(src.indexOf("export async function verifyPhoneSignIn"), src.indexOf("async function createMobileAccount"));

  it("upgrades only for the exact intent \"owner\", after MSG91 approves and after the session is minted", () => {
    const approved = verify.indexOf("if (!result.approved) return");
    const minted = verify.indexOf("const minted = await mintSessionForUser(userId);");
    const mintFailed = verify.indexOf("if (!minted.ok)");
    const upgrade = verify.indexOf('if (intent === "owner") {');
    expect(approved).toBeGreaterThan(0);
    expect(minted).toBeGreaterThan(approved);
    expect(mintFailed).toBeGreaterThan(minted);
    expect(upgrade).toBeGreaterThan(mintFailed);
    expect(verify).toContain("await upgradeCustomerToOwner(admin, userId);");
    expect((verify.match(/upgradeCustomerToOwner\(/g) ?? []).length).toBe(1);
  });

  it("still creates every mobile account as a customer — no role in the user metadata", () => {
    const create = src.slice(src.indexOf("async function createMobileAccount"));
    const call = create.slice(create.indexOf("admin.auth.admin.createUser({"), create.indexOf("});", create.indexOf("admin.auth.admin.createUser({")));
    expect(call).not.toMatch(/user_metadata|data\s*:|role/);
  });
});

describe("one rule, two doors, nowhere else", () => {
  it("the Google callback uses the same function", () => {
    const cb = code("app/auth/callback/route.ts");
    expect(cb).toContain("await upgradeCustomerToOwner(getSupabaseAdminClient(), userId);");
    expect(cb).not.toMatch(/\.update\(\{\s*role:/);
  });

  it("only the owner sign-up page asks for the owner intent; /login never does", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(root, rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(name)) files.push(rel);
      }
    };
    walk("app");
    walk("components");
    const askers = files.filter((f) => /verifyPhoneSignIn\([^)]*"owner"\)/.test(code(f)));
    expect(askers).toEqual(["app/owner/register/_components/OwnerRegisterForm.tsx"]);
    expect(code("app/(auth)/login/page.tsx")).toContain("await verifyPhoneSignIn(`+91${ten}`, code);");
  });

  it("only the shared function and the admin console write the owner role", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(root, rel)).isDirectory()) { if (name !== "__tests__") walk(rel); }
        else if (/\.tsx?$/.test(name)) files.push(rel);
      }
    };
    walk("app");
    walk("lib");
    walk("components");
    const writers = files.filter((f) => /\.update\(\{\s*role:\s*"owner_approved"/.test(code(f)));
    expect(writers.sort()).toEqual(["app/admin/actions.ts", "lib/auth/owner-upgrade.ts"]);
  });

  it("the owner sign-up offers both doors and lands on the role router", () => {
    const form = code("app/owner/register/_components/OwnerRegisterForm.tsx");
    expect(form).toContain("Continue with Google");
    expect(form).toContain("Continue with mobile");
    expect(form).toContain('const AFTER_SIGN_UP = "/auth/redirect";');
    expect(form).toContain("rememberOwnerIntent();");
  });
});
