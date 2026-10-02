import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIARY_STRINGS,
  addMonthsToKey,
  balanceDue,
  formatDiaryDates,
  formatDiaryDay,
  formatMonthTitle,
  formatWeekday,
  monthEndIso,
  parseAmountInput,
  parseDiaryLang,
  paymentState,
  receiptMessage,
  reminderMessage,
  whatsappDigits,
  whatsappUrl,
  type DiaryMessageInput,
} from "../diary";
import { diaryBookingUpdateSchema, offlineBookingSchema } from "../validation/schemas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const HALL = "11111111-1111-4111-8111-111111111111";
const BOOKING = "22222222-2222-4222-8222-222222222222";

describe("the two languages", () => {
  const en = DIARY_STRINGS.en;
  const ta = DIARY_STRINGS.ta;

  it("have the same keys, none blank", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ta)) expect(v.trim(), k).not.toBe("");
  });

  it("use the same {placeholders} in every string", () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(holes(ta[k]), k).toEqual(holes(en[k]));
    }
  });

  it("is actually Tamil on the Tamil side", () => {
    // Every Tamil string carries Tamil script, apart from ones that are only a
    // brand name, a number pattern or punctuation.
    const untranslated = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v));
    expect(untranslated).toEqual([]);
  });

  it("falls back to English for anything but 'ta'", () => {
    expect(parseDiaryLang("ta")).toBe("ta");
    expect(parseDiaryLang("en")).toBe("en");
    expect(parseDiaryLang(undefined)).toBe("en");
    expect(parseDiaryLang("hi")).toBe("en");
  });
});

describe("money", () => {
  it("treats a missing total as not recorded, never as zero", () => {
    expect(balanceDue(null, null)).toBeNull();
    expect(balanceDue(null, 5000)).toBeNull();
    expect(paymentState(null, null)).toBe("unrecorded");
  });

  it("works out what is still due", () => {
    expect(balanceDue(160000, 40000)).toBe(120000);
    expect(balanceDue(160000, null)).toBe(160000);
    expect(balanceDue(160000, 160000)).toBe(0);
    expect(paymentState(160000, 40000)).toBe("due");
    expect(paymentState(160000, 160000)).toBe("paid");
  });

  it("reads amounts the way owners write them", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("  ")).toBeNull();
    expect(parseAmountInput("1,60,000")).toBe(160000);
    expect(parseAmountInput("₹40000")).toBe(40000);
    expect(parseAmountInput("2500.50")).toBe(2500.5);
    expect(parseAmountInput("-500")).toBeNaN();
    expect(parseAmountInput("40k")).toBeNaN();
  });
});

describe("dates", () => {
  it("writes one day in each language", () => {
    expect(formatDiaryDay("en", "2026-10-25")).toBe("Sun, 25 Oct");
    expect(formatDiaryDay("en", "2026-10-25", { year: true })).toBe("Sun, 25 Oct 2026");
    expect(formatDiaryDay("ta", "2026-10-25")).toBe("25 அக்டோபர், ஞாயிறு");
    expect(formatDiaryDay("ta", "2026-10-25", { year: true })).toBe("25 அக்டோபர் 2026, ஞாயிறு");
    expect(formatWeekday("ta", "2026-11-11")).toBe("புதன்");
  });

  it("writes ranges inside and across months", () => {
    expect(formatDiaryDates("en", "2026-11-13", "2026-11-15")).toBe("13–15 Nov");
    expect(formatDiaryDates("en", "2026-10-30", "2026-11-02")).toBe("30 Oct – 2 Nov");
    expect(formatDiaryDates("ta", "2026-11-13", "2026-11-15")).toBe("13–15 நவம்பர்");
    expect(formatDiaryDates("en", "2026-11-13", "2026-11-13")).toBe("Fri, 13 Nov");
  });

  it("does month arithmetic on strings", () => {
    expect(addMonthsToKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToKey("2026-01", -1)).toBe("2025-12");
    expect(monthEndIso("2027-02")).toBe("2027-02-28");
    expect(monthEndIso("2028-02")).toBe("2028-02-29");
    expect(formatMonthTitle("ta", "2026-11")).toBe("நவம்பர் 2026");
  });
});

describe("WhatsApp", () => {
  it("turns the numbers owners type into wa.me digits", () => {
    expect(whatsappDigits("9876543210")).toBe("919876543210");
    expect(whatsappDigits("+91 98765 43210")).toBe("919876543210");
    expect(whatsappDigits("098765 43210")).toBe("919876543210");
    expect(whatsappDigits("12345")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });

  it("lets WhatsApp ask for the contact when the number is unusable", () => {
    expect(whatsappUrl(null, "hi")).toBe("https://wa.me/?text=hi");
    expect(whatsappUrl("9876543210", "a b")).toBe("https://wa.me/919876543210?text=a%20b");
  });

  const booking: DiaryMessageInput = {
    hallName: "NS KHALYAANA MAHAL",
    customerName: "Ravi",
    eventDate: "2026-11-13",
    endDate: "2026-11-13",
    slot: "full_day",
    totalAmount: 160000,
    amountReceived: 40000,
  };

  it("puts the money on the receipt only when it was recorded", () => {
    const withMoney = receiptMessage("en", booking);
    expect(withMoney).toContain("*NS KHALYAANA MAHAL*");
    expect(withMoney).toContain("Name: Ravi");
    expect(withMoney).toContain("Date: Fri, 13 Nov 2026 · Full day");
    expect(withMoney).toContain("Total: ₹1,60,000");
    expect(withMoney).toContain("Received: ₹40,000");
    expect(withMoney).toContain("Balance: ₹1,20,000");

    const noMoney = receiptMessage("en", { ...booking, totalAmount: null, amountReceived: null });
    expect(noMoney).not.toContain("Total");
    expect(noMoney).not.toContain("Balance");
  });

  it("ends every receipt with hallnect.com, but keeps reminders the venue's own", () => {
    expect(receiptMessage("en", booking).split("\n").at(-1)).toBe("Sent with Hallnect · hallnect.com");
    expect(receiptMessage("ta", booking).split("\n").at(-1)).toBe("Hallnect வழியாக அனுப்பப்பட்டது · hallnect.com");
    expect(reminderMessage("en", booking)).not.toContain("hallnect.com");
    expect(reminderMessage("ta", booking)).not.toContain("hallnect.com");
  });

  it("writes the receipt and reminder in Tamil", () => {
    expect(receiptMessage("ta", booking)).toContain("மீதம்: ₹1,20,000");
    const reminder = reminderMessage("ta", booking);
    expect(reminder).toContain("₹1,20,000");
    expect(reminder).toContain("13 நவம்பர் 2026, வெள்ளி");
  });
});

describe("what the server action accepts", () => {
  // A server action DROPS undefined keys, so "absent" is the real shape of a
  // blank optional — see lib/__tests__/coupon-schema.test.ts.
  const base = { hallId: HALL, eventDate: "2026-11-13", endDate: "2026-11-13", slot: "full_day" };

  it("takes a booking with no money at all, key absent or blank", () => {
    const absent = offlineBookingSchema.safeParse(base);
    expect(absent.success).toBe(true);
    const blank = offlineBookingSchema.safeParse({ ...base, totalAmount: "", amountReceived: "" });
    expect(blank.success).toBe(true);
    if (blank.success) {
      expect(blank.data.totalAmount).toBeNull();
      expect(blank.data.amountReceived).toBeNull();
    }
  });

  it("refuses more received than the total, and a mistyped extra zero", () => {
    expect(offlineBookingSchema.safeParse({ ...base, totalAmount: 1000, amountReceived: 2000 }).success).toBe(false);
    expect(offlineBookingSchema.safeParse({ ...base, totalAmount: 1_000_000_000 }).success).toBe(false);
    expect(offlineBookingSchema.safeParse({ ...base, totalAmount: -1 }).success).toBe(false);
  });

  it("edits the private detail with the same rules", () => {
    const edit = { id: BOOKING, hallId: HALL, customerName: "Ravi", customerPhone: "", notes: "" };
    expect(diaryBookingUpdateSchema.safeParse(edit).success).toBe(true);
    expect(diaryBookingUpdateSchema.safeParse({ ...edit, totalAmount: 5000, amountReceived: 6000 }).success).toBe(false);
    expect(diaryBookingUpdateSchema.safeParse({ ...edit, totalAmount: 5000, amountReceived: 5000 }).success).toBe(true);
  });
});

describe("the diary's wiring", () => {
  const page = read("app/owner/(dashboard)/diary/page.tsx");
  const actions = read("app/owner/(dashboard)/actions.ts");
  const lib = read("lib/offline-bookings.ts");
  const migration = read("supabase/migrations/0106_offline_booking_money.sql");

  it("is for approved owners only", () => {
    expect(page).toContain('requireRole(["owner_approved"])');
  });

  it("reads strictly, so a failed read is never an empty diary", () => {
    expect(page).toContain("fetchOfflineBookings(hall.id, { strict: true })");
    expect(lib).toContain('if (opts?.strict) throw new Error("Could not load your diary.");');
    expect(read("lib/owner-diary.ts")).toContain('throw new Error("Could not load your diary.");');
  });

  it("only shows a hall the owner owns", () => {
    expect(page).toContain("halls.find((h) => h.id === sp.hall) ?? halls[0]");
  });

  it("writes only through the RPCs — never the table", () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir)).flatMap((f) => {
        const p = `${dir}/${f}`;
        if (statSync(join(root, p)).isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(f) ? [p] : [];
      });
    for (const f of [...walk("app"), ...walk("lib").filter((f) => !f.includes("__tests__"))]) {
      // Code only: lib/offline-bookings.ts has a comment WARNING against
      // exactly this call, and the warning must not count as the call.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/from\("offline_bookings"\)\s*\.(insert|update|upsert|delete)\(/);
    }
    expect(lib).toContain('db.rpc("update_offline_booking"');
    expect(actions).toContain("parseSafe(diaryBookingUpdateSchema, input)");
  });

  it("replaces the nine-argument RPC rather than overloading it", () => {
    expect(migration).toContain(
      "drop function if exists public.create_offline_booking(uuid, date, date, booking_slot, text, text, text, text, uuid);",
    );
    expect(migration).toContain("create_offline_booking is overloaded");
    expect(migration).toContain("offline_bookings_received_le_total");
  });

  it("installs to the home screen and opens on the diary", () => {
    expect(page).toContain('manifest: "/diary.webmanifest"');
    const manifest = JSON.parse(read("public/diary.webmanifest"));
    expect(manifest.start_url).toBe("/owner/diary");
    expect(manifest.scope).toBe("/owner/");
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("sits in the owner tab bar, with Revenue moved to More", () => {
    const tabs = read("app/owner/(dashboard)/_components/OwnerBottomNav.tsx");
    expect(tabs).toContain('href: "/owner/diary"');
    expect(tabs).not.toContain('href: "/owner/revenue"');
    expect(read("app/owner/(dashboard)/more/page.tsx")).toContain('href: "/owner/revenue"');
    expect(read("app/owner/(dashboard)/_components/OwnerSidebarNav.tsx")).toContain('href: "/owner/diary"');
  });
});
