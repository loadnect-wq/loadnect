import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STANDARD_COMMISSION_PERCENT,
  COMMISSION_RATE,
  COMMISSION_PERCENT_LABEL,
  calculateBookingCommission,
} from "@/lib/commission";
import { calculateBookingPayment } from "@/lib/booking-payment";
import { calculateLeadCommission } from "@/lib/leads";
import { commissionPaiseOn, toPaise } from "@/lib/money";
import * as schemas from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// ONE standard Hallnect commission: 2.5% of the booking amount (migration 0100;
// it was 2% under 0097).
//
// Behaviour for the arithmetic, and source-level invariants for "the old
// owner-selectable system is gone" — the only way to prove an absence is to
// look for it. The database side was ALSO exercised against the live schema in
// a rolled-back transaction, as the service role (the only booking writer):
//   booking at 0.5% / ₹500 on ₹1,00,000     refused by trigger
//   booking at 2.5% but ₹500                 refused by trigger
//   booking at 2.5% / ₹2,500                 accepted
//   hall commission_rate set to 4.5          refused by CHECK
//   platform commission_percent set to 3     refused by CHECK
//   standard_commission_amount(12345.67)     308.64
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Source with comments removed, so notes describing the old system do not count. */
function code(rel: string): string {
  return read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the rate", () => {
  it("is 2.5%, in one place", () => {
    expect(STANDARD_COMMISSION_PERCENT).toBe(2.5);
    expect(COMMISSION_RATE).toBe(0.025);
    expect(COMMISSION_PERCENT_LABEL).toBe("2.5%");
  });
});

describe("the business examples", () => {
  const CASES = [
    [10_000, 250],
    [25_000, 625],
    [50_000, 1_250],
    [100_000, 2_500],
  ] as const;

  for (const [amount, commission] of CASES) {
    it(`₹${amount.toLocaleString("en-IN")} → ₹${commission.toLocaleString("en-IN")}`, () => {
      expect(calculateBookingCommission(amount)).toBe(commission);
      // The same figure from both real calculators, so no screen or API can
      // produce a different commission for the same booking.
      expect(calculateBookingPayment({ hallTotal: amount }).commissionAmount).toBe(commission);
      expect(calculateLeadCommission({ agreedAmount: amount }).commissionAmount).toBe(commission);
    });
  }

  it("a non-round amount is floored to the paisa, never rounded up", () => {
    // 12,345.67 × 2.5% = 308.64175 → ₹308.64
    expect(calculateBookingCommission(12_345.67)).toBe(308.64);
    // 11,111.42 × 2.5% = 27,778.55 paise → 27,778 paise (rounding would say 27,779)
    expect(calculateBookingCommission(11_111.42)).toBe(277.78);
    expect(calculateBookingPayment({ hallTotal: 12_345.67 }).commissionAmount).toBe(308.64);
    expect(calculateLeadCommission({ agreedAmount: 12_345.67 }).commissionAmount).toBe(308.64);
  });

  it("uses the shared integer-paise primitive, not its own arithmetic", () => {
    for (const amount of [1, 999.99, 33_333.33, 1_234_567.89]) {
      expect(toPaise(calculateBookingCommission(amount)))
        .toBe(commissionPaiseOn(toPaise(amount), STANDARD_COMMISSION_PERCENT));
    }
  });

  it("refuses a negative or non-finite amount", () => {
    for (const bad of [-1, NaN, Infinity]) {
      expect(() => calculateBookingCommission(bad)).toThrow(RangeError);
    }
  });
});

describe("the client cannot change it", () => {
  it("a fake commission in a booking request is ignored", () => {
    const tamperedRequest = { hallTotal: 100_000, commissionRate: 0.5, commissionAmount: 500 };
    const pay = calculateBookingPayment(tamperedRequest);
    expect(pay.commissionRate).toBe(2.5);
    expect(pay.commissionAmount).toBe(2_500);
  });

  it("a fake rate on an enquiry confirmation is ignored", () => {
    const tamperedConfirm = { agreedAmount: 100_000, commissionRate: 0.5 };
    expect(calculateLeadCommission(tamperedConfirm).commissionAmount).toBe(2_500);
  });

  it("the booking action never reads a rate from the request, the hall or a setting", () => {
    const action = code("app/book/[slug]/actions.ts");
    for (const gone of ["input.commissionRate", "v.commissionRate", "getCommissionPercent", "readHallCommissionRate", "commission_percent"]) {
      expect(action, gone).not.toContain(gone);
    }
    // The calculator call carries no rate; the snapshot written afterwards is
    // the calculator's own OUTPUT (pay.commissionRate / pay.commissionAmount).
    const call = action.slice(action.indexOf("calculateBookingPayment({"), action.indexOf("});", action.indexOf("calculateBookingPayment({")));
    expect(call).not.toContain("commission");
    expect(action).toContain("commission_rate:       pay.commissionRate,");
    expect(action).toContain("commission_amount:     pay.commissionAmount,");
  });

  it("the enquiry confirmation takes only the agreed amount", () => {
    const leads = code("lib/leads.ts");
    expect(leads).toContain("calculateLeadCommission({ agreedAmount: input.agreedAmount })");
    expect(leads).not.toContain("resolveLeadCommissionRate");
    expect(leads).not.toContain("getCommissionPercent");
  });

  it("an owner's hall request has no commission field — it is stripped if sent", () => {
    const listing = {
      ownerId: "11111111-2222-4333-8444-555555555555",
      name: "Sri Meenakshi Mahal", city: "Madurai", state: "", address: "", pincode: "625006",
      capacityMin: null, capacityMax: 500, pricePerDay: 40_000, priceMorning: null, priceEvening: null,
      description: "", amenityIds: [], venueTypes: ["wedding"],
      commissionRate: 5,
    };
    const r = schemas.hallCreateSchema.safeParse(listing);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("commissionRate");
    // And the owner's create action writes the constant, not an input.
    expect(code("app/owner/(dashboard)/actions.ts")).toContain("commission_rate: STANDARD_COMMISSION_PERCENT,");
  });
});

describe("the old owner-selectable system is removed", () => {
  it("no rate list, rate schema or rate setting is exported", () => {
    for (const gone of ["HALL_COMMISSION_RATES", "commissionRateSchema", "isAllowedCommissionRate", "commissionPercentSchema"]) {
      expect(schemas, gone).not.toHaveProperty(gone);
    }
  });

  it("no owner, admin or payment code references the old rate machinery", () => {
    const files = [
      "app/owner/(dashboard)/halls/_components/HallForm.tsx",
      "app/owner/(dashboard)/actions.ts",
      "app/owner/(dashboard)/revenue/page.tsx",
      "app/owner/(dashboard)/commissions/page.tsx",
      "app/owner/(dashboard)/leads/page.tsx",
      "app/owner/(dashboard)/leads/_components/LeadActions.tsx",
      "app/owner/register/page.tsx",
      "app/admin/actions.ts",
      "app/admin/settings/page.tsx",
      "app/admin/halls/page.tsx",
      "lib/admin.ts",
      "lib/owner.ts",
      "lib/platform-settings.ts",
      "lib/payments.ts",
      "lib/hall-commission.ts",
    ];
    const machinery = [
      "HALL_COMMISSION_RATES", "commissionRateSchema", "setHallCommissionRate",
      "readHallCommissionRate", "maxConfiguredCommissionRate", "sortByCommissionRate",
      "getCommissionPercent", "updateCommissionPercent", "CommissionRateForm",
      "DEFAULT_COMMISSION_PERCENT",
    ];
    for (const f of files) {
      const src = code(f);
      for (const m of machinery) expect(src, `${f} still uses ${m}`).not.toContain(m);
    }
    expect(exists("app/admin/settings/_components/CommissionRateForm.tsx")).toBe(false);
  });

  it("the owner's hall form shows the rate and offers no choice", () => {
    const form = code("app/owner/(dashboard)/halls/_components/HallForm.tsx");
    expect(form).toContain("Hallnect Commission: ");
    expect(form).toContain("{COMMISSION_PERCENT_LABEL}");
    expect(form).not.toContain('role="radiogroup"\n          aria-label="Hallnect commission');
    expect(form).not.toContain("setCommissionRate");
    expect(form).not.toMatch(/commissionRate/);
  });

  it("the admin settings page states the rate and has no form for it", () => {
    const page = code("app/admin/settings/page.tsx");
    expect(page).toContain('label="Standard Hallnect commission" value={COMMISSION_PERCENT_LABEL}');
    expect(page).not.toMatch(/Commission\w*Form/);
  });

  it("the admin halls list offers no per-rate filter or sort", () => {
    const page = code("app/admin/halls/page.tsx");
    for (const gone of ["COMMISSION_FILTERS", "comm_desc", "comm_asc", "Not configured"]) {
      expect(page, gone).not.toContain(gone);
    }
  });

  it("no user-facing page still quotes an old percentage", () => {
    const pages = [
      "app/owner/register/page.tsx",
      "app/owner/(dashboard)/revenue/page.tsx",
      "app/owner/(dashboard)/commissions/page.tsx",
      "app/owner/(dashboard)/profile/_components/PayoutSetup.tsx",
      "app/owner/(dashboard)/halls/_components/HallForm.tsx",
      "app/admin/commissions/page.tsx",
      "app/admin/settings/_components/PaymentSettingsForm.tsx",
      "app/page.tsx",
      "app/(legal)/terms/page.tsx",
    ];
    for (const p of pages) {
      const src = code(p);
      // No hand-written rate at all: owner/admin pages print COMMISSION_PERCENT_LABEL.
      expect(src, p).not.toMatch(/(?<![\d.])(1\.5|2|2\.5|3|3\.5|4|4\.5|5)\s?%/);
      expect(src, p).not.toMatch(/you choose your own\s+commission|anywhere from/i);
      expect(src, p).not.toMatch(/rate its owner chose|fallback for a hall/i);
    }
  });
});

describe("the database enforces the same rule (0097)", () => {
  const sql = read("supabase/migrations/0097_standard_commission_two_percent.sql");

  it("constrains new bookings and new lead commissions to 2% and the exact amount", () => {
    expect(sql).toContain("before insert on public.bookings");
    expect(sql).toContain("before insert on public.commissions");
    expect(sql).toContain("public.standard_commission_amount(new.total_amount)");
    expect(sql).toContain("public.standard_commission_amount(new.booking_amount)");
  });

  it("locks the hall and platform values to the standard rate", () => {
    expect(sql).toContain("check (commission_rate is null or commission_rate = 2)");
    expect(sql).toContain("check (commission_percent = 2)");
    expect(sql).toContain("drop constraint if exists halls_commission_rate_allowed");
  });

  it("is non-destructive: no column dropped, no historical row rewritten", () => {
    const body = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(body).not.toMatch(/drop\s+column|drop\s+table|delete\s+from|truncate/i);
    expect(body).not.toMatch(/update\s+public\.(bookings|commissions|payments|payment_transactions)/i);
  });

  it("the advance can always hold the standard commission", () => {
    expect(schemas.checkCommissionAgainstAdvance(STANDARD_COMMISSION_PERCENT, 25, "advance").ok).toBe(true);
  });
});

describe("the database moves to 2.5% and stops publishing the rate (0100)", () => {
  const sql = read("supabase/migrations/0100_commission_two_and_half_fee_hundred.sql");
  const body = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("sets the standard percent and both CHECKs to 2.5", () => {
    expect(body).toContain("as $$ select 2.5::numeric $$;");
    expect(body).toContain("check (commission_rate is null or commission_rate = 2.5)");
    expect(body).toContain("check (commission_percent = 2.5)");
  });

  it("closes the commission functions to the API roles without breaking the triggers", () => {
    expect(body).toMatch(/revoke execute on function public\.get_commission_percent\(\)\s+from public, anon, authenticated;/);
    expect(body).toMatch(/revoke execute on function public\.standard_commission_percent\(\)\s+from public, anon, authenticated;/);
    expect(body).toMatch(/revoke execute on function public\.standard_commission_amount\(numeric\)\s+from public, anon, authenticated;/);
    expect(body).not.toMatch(/grant\s+execute[^;]*commission/i);
    expect(body).toContain("alter function public.enforce_standard_booking_commission() security definer;");
    expect(body).toContain("alter function public.enforce_standard_lead_commission()    security definer;");
  });

  it("is non-destructive: no column dropped, no historical row rewritten", () => {
    expect(body).not.toMatch(/drop\s+column|drop\s+table|delete\s+from|truncate/i);
    expect(body).not.toMatch(/update\s+public\.(bookings|commissions|payments|leads)/i);
  });
});

describe("the rate is not disclosed on public or customer pages", () => {
  // Owners see it signed in (owner dashboard), admins in admin settings.
  const PUBLIC = [
    "app/page.tsx",
    "app/about/page.tsx",
    "app/owner/register/page.tsx",
    "app/owner/register/layout.tsx",
    "app/premium/page.tsx",
    "app/halls/[slug]/_components/HallDetailView.tsx",
    "app/book/[slug]/page.tsx",
    "app/book/[slug]/_components/BookingFlow.tsx",
    "app/enquiry/[slug]/_components/EnquiryFlow.tsx",
    "app/booking/[id]/status/page.tsx",
    "app/customer/bookings/[id]/page.tsx",
    "app/(legal)/terms/page.tsx",
    "app/(legal)/refund-policy/page.tsx",
    "app/(legal)/cancellation-policy/page.tsx",
  ];
  for (const p of PUBLIC) {
    it(p, () => {
      const src = code(p);
      for (const leak of ["COMMISSION_PERCENT_LABEL", "STANDARD_COMMISSION_PERCENT", "COMMISSION_RATE", "calculateBookingCommission", "commissionRate", "commissionAmount"]) {
        expect(src, `${p} uses ${leak}`).not.toContain(leak);
      }
      expect(src).not.toMatch(/commission[^.]{0,40}\d(\.\d+)?\s?%|\d(\.\d+)?\s?%[^.]{0,40}commission/i);
      expect(src).not.toMatch(/Keep \{?100 -|Keep \d+(\.\d+)?% of/);
    });
  }
});
