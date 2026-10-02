// ─────────────────────────────────────────────────────────────────────────────
// lib/diary.ts — the owner's booking diary: words, money, dates, WhatsApp.
//
// CLIENT-SAFE AND PURE. No database, no server-only imports; the diary screen
// and the tests both use it directly.
//
// WHY A DIARY. A mahal manager runs the business from a paper notebook: who
// booked which date, what was agreed, what has come in. Every competitor asks
// owners to pay and wait for leads; this replaces the notebook, which is
// useful on day one even when Hallnect sends no customers. Every date marked
// here also becomes live availability (create_offline_booking projects it into
// `availability`), which is what makes date search on the public site truthful.
//
// TWO LANGUAGES, ONE KEY SET. STRINGS.ta is typed against STRINGS.en, so a key
// missing from either fails the build rather than rendering blank. The Tamil
// should be reviewed by a native speaker before the diary is promoted.
//
// MONEY: null means NOT RECORDED. A booking blocked with no amount discussed is
// "no amount", never "Rs.0, fully paid" — the same rule as the database (0106).
// ─────────────────────────────────────────────────────────────────────────────

import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { TAMIL_MONTHS, TAMIL_WEEKDAYS } from "@/lib/seo/tamil";

export type DiaryLang = "en" | "ta";
export type DiarySlot = "full_day" | "morning" | "evening";

/** Remembered per device; read on the server so the first paint is already right. */
export const DIARY_LANG_COOKIE = "hn_diary_lang";

export function parseDiaryLang(raw: string | undefined | null): DiaryLang {
  return raw === "ta" ? "ta" : "en";
}

const EN = {
  title: "Booking diary",
  subtitle: "Every function, who has paid, and what is still due.",
  addBooking: "Add booking",
  comingUp: "Coming up",
  toCollect: "To collect",
  bookingUnitOne: "booking",
  bookingUnitMany: "bookings",
  nothingDue: "Nothing due",
  noUpcoming: "No bookings coming up. When a customer books by phone or in person, tap “Add booking”.",
  pastDue: "Still to collect from past functions",
  moneyDueOnly: "Money due only",
  noneDue: "No money is due on any booking.",
  legendFree: "Free",
  legendYours: "Your booking",
  legendOnline: "Hallnect booking",
  legendBlocked: "Blocked by Hallnect",
  legendMuhurtham: "Muhurtham day",
  today: "Today",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  slot_full_day: "Full day",
  slot_morning: "Morning",
  slot_evening: "Evening",
  newBooking: "New booking",
  editBooking: "Edit booking",
  fieldDate: "Date",
  fieldUntil: "Last day",
  fieldUntilHint: "Only for a function over more than one day",
  fieldSlot: "Part of the day",
  fieldName: "Customer name",
  fieldPhone: "Phone",
  fieldTotal: "Total amount (₹)",
  fieldReceived: "Advance received (₹)",
  fieldNotes: "Notes",
  fieldNotesHint: "Function type, catering, anything to remember",
  balance: "Balance",
  datesLocked: "To change the date, cancel this booking and add it again.",
  save: "Save booking",
  saveChanges: "Save changes",
  saving: "Saving…",
  total: "Total",
  received: "Received",
  paidInFull: "Paid in full",
  dueAmount: "₹{amount} due",
  noAmount: "No amount recorded",
  sendReceipt: "Send receipt on WhatsApp",
  sendReminder: "Send payment reminder",
  recordPayment: "Record a payment",
  paymentAmount: "Amount received now (₹)",
  addPayment: "Add payment",
  edit: "Edit",
  call: "Call",
  cancelBooking: "Cancel booking",
  confirmCancel: "Tap again to cancel. The date becomes free.",
  close: "Close",
  onlineNote: "Booked and paid on Hallnect. Manage it in Bookings.",
  openBookings: "Open Bookings",
  blockedNote: "Blocked by Hallnect. Contact support to lift it.",
  dayFull: "This day is fully booked.",
  addOnDay: "Add booking on this day",
  saved: "Saved",
  cancelled: "Booking cancelled. The date is free again.",
  paymentRecorded: "Payment recorded",
  noName: "No name",
  hall: "Hall",
  days: "{n} days",
  privacy: "Only you and Hallnect support can see names, phone numbers and amounts. Customers only see that the date is taken.",
  noHall: "Add your hall first, then keep its bookings here.",
  addHall: "Add your hall",
  installTitle: "Keep the diary on your home screen",
  installBody: "It opens straight to your bookings, like an app.",
  installButton: "Add to home screen",
  installIos: "In Safari, tap Share, then “Add to Home Screen”.",
  notNow: "Not now",
  amountTooLarge: "The amount received cannot be more than the total.",
  invalidAmount: "Enter an amount in rupees.",
  errorGeneric: "Could not save. Check your connection and try again.",
  wa_confirmed: "Booking confirmed",
  wa_reminder: "Payment reminder",
  wa_name: "Name",
  wa_date: "Date",
  wa_total: "Total",
  wa_received: "Received",
  wa_balance: "Balance",
  wa_reminderLine: "A balance of ₹{amount} is due for your booking on {dates}.",
  wa_thanks: "Thank you.",
  wa_footer: "Sent with Hallnect · hallnect.com",
} as const;

type DiaryKey = keyof typeof EN;

const TA: Record<DiaryKey, string> = {
  title: "முன்பதிவு டைரி",
  subtitle: "ஒவ்வொரு விழாவும், யார் செலுத்தினார்கள், இன்னும் எவ்வளவு வர வேண்டும்.",
  addBooking: "முன்பதிவு சேர்",
  comingUp: "வரவிருப்பவை",
  toCollect: "வசூலிக்க வேண்டியது",
  bookingUnitOne: "முன்பதிவு",
  bookingUnitMany: "முன்பதிவுகள்",
  nothingDue: "நிலுவை இல்லை",
  noUpcoming: "வரவிருக்கும் முன்பதிவுகள் இல்லை. வாடிக்கையாளர் போனிலோ நேரிலோ முன்பதிவு செய்தால், “முன்பதிவு சேர்” என்பதைத் தொடுங்கள்.",
  pastDue: "முடிந்த விழாக்களில் இன்னும் வசூலிக்க வேண்டியது",
  moneyDueOnly: "நிலுவை உள்ளவை மட்டும்",
  noneDue: "எந்த முன்பதிவிலும் நிலுவை இல்லை.",
  legendFree: "காலி",
  legendYours: "உங்கள் முன்பதிவு",
  legendOnline: "Hallnect முன்பதிவு",
  legendBlocked: "Hallnect தடுத்தது",
  legendMuhurtham: "முகூர்த்த நாள்",
  today: "இன்று",
  prevMonth: "முந்தைய மாதம்",
  nextMonth: "அடுத்த மாதம்",
  slot_full_day: "முழு நாள்",
  slot_morning: "காலை",
  slot_evening: "மாலை",
  newBooking: "புதிய முன்பதிவு",
  editBooking: "முன்பதிவைத் திருத்து",
  fieldDate: "தேதி",
  fieldUntil: "கடைசி நாள்",
  fieldUntilHint: "ஒரு நாளுக்கு மேல் நடக்கும் விழாவுக்கு மட்டும்",
  fieldSlot: "நேரம்",
  fieldName: "வாடிக்கையாளர் பெயர்",
  fieldPhone: "கைபேசி எண்",
  fieldTotal: "மொத்தத் தொகை (₹)",
  fieldReceived: "பெற்ற முன்பணம் (₹)",
  fieldNotes: "குறிப்புகள்",
  fieldNotesHint: "விழா வகை, சமையல், நினைவில் கொள்ள வேண்டியவை",
  balance: "மீதம்",
  datesLocked: "தேதியை மாற்ற, இந்த முன்பதிவை ரத்து செய்து மீண்டும் சேர்க்கவும்.",
  save: "முன்பதிவைச் சேமி",
  saveChanges: "மாற்றங்களைச் சேமி",
  saving: "சேமிக்கிறது…",
  total: "மொத்தம்",
  received: "பெற்றது",
  paidInFull: "முழுமையாகச் செலுத்தப்பட்டது",
  dueAmount: "₹{amount} வர வேண்டும்",
  noAmount: "தொகை பதிவு செய்யப்படவில்லை",
  sendReceipt: "WhatsApp-இல் ரசீது அனுப்பு",
  sendReminder: "பண நினைவூட்டல் அனுப்பு",
  recordPayment: "வந்த பணத்தைப் பதிவு செய்",
  paymentAmount: "இப்போது பெற்ற தொகை (₹)",
  addPayment: "பணத்தைச் சேர்",
  edit: "திருத்து",
  call: "அழை",
  cancelBooking: "முன்பதிவை ரத்து செய்",
  confirmCancel: "ரத்து செய்ய மீண்டும் தொடுங்கள். தேதி காலியாகும்.",
  close: "மூடு",
  onlineNote: "Hallnect-இல் முன்பதிவு செய்து பணம் செலுத்தப்பட்டது. ‘Bookings’ பக்கத்தில் நிர்வகிக்கவும்.",
  openBookings: "Bookings-ஐத் திற",
  blockedNote: "Hallnect தடுத்துள்ளது. நீக்க, உதவி மையத்தைத் தொடர்பு கொள்ளுங்கள்.",
  dayFull: "இந்த நாள் முழுவதும் முன்பதிவாகியுள்ளது.",
  addOnDay: "இந்த நாளில் முன்பதிவு சேர்",
  saved: "சேமிக்கப்பட்டது",
  cancelled: "முன்பதிவு ரத்தானது. தேதி மீண்டும் காலி.",
  paymentRecorded: "பணம் பதிவானது",
  noName: "பெயர் இல்லை",
  hall: "மண்டபம்",
  days: "{n} நாட்கள்",
  privacy: "பெயர், கைபேசி எண், தொகைகளை நீங்களும் Hallnect உதவிக் குழுவும் மட்டுமே பார்க்க முடியும். வாடிக்கையாளர்களுக்கு அந்தத் தேதி முன்பதிவானது என்பது மட்டுமே தெரியும்.",
  noHall: "முதலில் உங்கள் மண்டபத்தைச் சேர்த்து, அதன் முன்பதிவுகளை இங்கே பதிவு செய்யுங்கள்.",
  addHall: "மண்டபத்தைச் சேர்",
  installTitle: "டைரியை உங்கள் முகப்புத் திரையில் வைத்திருங்கள்",
  installBody: "ஒரு செயலி போல, நேரடியாக உங்கள் முன்பதிவுகளுக்குத் திறக்கும்.",
  installButton: "முகப்புத் திரையில் சேர்",
  installIos: "Safari-யில் Share-ஐத் தொட்டு, “Add to Home Screen” என்பதைத் தேர்ந்தெடுங்கள்.",
  notNow: "இப்போது வேண்டாம்",
  amountTooLarge: "பெற்ற தொகை மொத்தத் தொகையை விட அதிகமாக இருக்கக் கூடாது.",
  invalidAmount: "தொகையை ரூபாயில் உள்ளிடுங்கள்.",
  errorGeneric: "சேமிக்க முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலுங்கள்.",
  wa_confirmed: "முன்பதிவு உறுதி",
  wa_reminder: "பண நினைவூட்டல்",
  wa_name: "பெயர்",
  wa_date: "தேதி",
  wa_total: "மொத்தம்",
  wa_received: "பெற்றது",
  wa_balance: "மீதம்",
  wa_reminderLine: "{dates} அன்று உள்ள உங்கள் முன்பதிவுக்கு மீதத் தொகை ₹{amount} செலுத்த வேண்டும்.",
  wa_thanks: "நன்றி.",
  wa_footer: "Hallnect வழியாக அனுப்பப்பட்டது · hallnect.com",
};

export const DIARY_STRINGS: Record<DiaryLang, Record<DiaryKey, string>> = { en: EN, ta: TA };

export type { DiaryKey };

/** Look up a string and fill {placeholders}. */
export function dt(lang: DiaryLang, key: DiaryKey, vars?: Record<string, string | number>): string {
  let out = DIARY_STRINGS[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export function slotLabel(lang: DiaryLang, slot: DiarySlot): string {
  return dt(lang, `slot_${slot}` as DiaryKey);
}

/** The noun under a count: "booking" / "bookings" — the number is drawn separately, large. */
export function bookingUnit(lang: DiaryLang, n: number): string {
  return n === 1 ? dt(lang, "bookingUnitOne") : dt(lang, "bookingUnitMany");
}

// ── Money ────────────────────────────────────────────────────────────────────

/** "1,60,000" — Indian grouping, no symbol, no decimals unless there are paise. */
export function formatAmount(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** What is still owed. null when no total was recorded — never assume zero. */
export function balanceDue(total: number | null, received: number | null): number | null {
  if (total == null) return null;
  return Math.max(0, total - (received ?? 0));
}

export type PaymentState = "unrecorded" | "paid" | "due";

export function paymentState(total: number | null, received: number | null): PaymentState {
  const due = balanceDue(total, received);
  if (due == null) return "unrecorded";
  return due === 0 ? "paid" : "due";
}

/**
 * Parse what an owner typed into an amount box. "" → null (not recorded);
 * commas and a leading ₹ are tolerated because that is how amounts are written.
 * Returns NaN for anything else so the form can say so.
 */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

// ── Dates ────────────────────────────────────────────────────────────────────

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * One day. en: "Sun, 25 Oct" (+ " 2026" with year). ta: "25 அக்டோபர், ஞாயிறு"
 * (+ year after the month). Written out, not Intl: en-IN puts a comma before
 * the year and the ta-IN short form is abbreviated past easy reading.
 */
export function formatDiaryDay(lang: DiaryLang, iso: string, opts?: { year?: boolean }): string {
  const { y, m, d, wd } = parts(iso);
  if (lang === "ta") {
    return `${d} ${TAMIL_MONTHS[m - 1]}${opts?.year ? ` ${y}` : ""}, ${TAMIL_WEEKDAYS[wd]}`;
  }
  return `${EN_WEEKDAYS[wd]}, ${d} ${EN_MONTHS[m - 1]}${opts?.year ? ` ${y}` : ""}`;
}

/** A booking's dates: one day, or "25–27 Oct", or "30 Oct – 2 Nov". */
export function formatDiaryDates(lang: DiaryLang, from: string, to: string, opts?: { year?: boolean }): string {
  if (!to || to === from) return formatDiaryDay(lang, from, opts);
  const a = parts(from);
  const b = parts(to);
  const months = lang === "ta" ? TAMIL_MONTHS : EN_MONTHS;
  const year = opts?.year ? ` ${b.y}` : "";
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${months[a.m - 1]}${year}`;
  return `${a.d} ${months[a.m - 1]} – ${b.d} ${months[b.m - 1]}${year}`;
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
//
// A wa.me link, not the WhatsApp Business API: it costs nothing, needs no
// template approval, and the message goes from the OWNER's own WhatsApp — to a
// customer who already has that number saved. The owner sees the text and
// presses send; nothing is sent on their behalf.

/** Digits for wa.me (country code, no "+"), or null when the number is unusable. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e164 = normalizePhoneE164(raw);
  return e164 ? e164.slice(1) : null;
}

/** Opens WhatsApp with the text ready. With no usable number, WhatsApp asks whom to send it to. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const digits = whatsappDigits(phone);
  return `https://wa.me/${digits ?? ""}?text=${encodeURIComponent(text)}`;
}

export type DiaryMessageInput = {
  hallName: string;
  customerName: string | null;
  eventDate: string;
  endDate: string;
  slot: DiarySlot;
  totalAmount: number | null;
  amountReceived: number | null;
};

/** The receipt: what was booked, and — only when recorded — the money. */
export function receiptMessage(lang: DiaryLang, b: DiaryMessageInput): string {
  const lines = [`*${b.hallName}*`, dt(lang, "wa_confirmed"), ""];
  if (b.customerName) lines.push(`${dt(lang, "wa_name")}: ${b.customerName}`);
  lines.push(
    `${dt(lang, "wa_date")}: ${formatDiaryDates(lang, b.eventDate, b.endDate, { year: true })} · ${slotLabel(lang, b.slot)}`,
  );
  if (b.totalAmount != null) {
    const received = b.amountReceived ?? 0;
    lines.push(
      `${dt(lang, "wa_total")}: ₹${formatAmount(b.totalAmount)}`,
      `${dt(lang, "wa_received")}: ₹${formatAmount(received)}`,
      `${dt(lang, "wa_balance")}: ₹${formatAmount(balanceDue(b.totalAmount, received) ?? 0)}`,
    );
  }
  // The last line is Hallnect's, on the owner's decision (2026-10-02): every
  // family that gets a receipt sees where the hall keeps its bookings, and
  // WhatsApp turns the domain into a link. Receipt only — the reminder is a
  // request for money and stays the venue's own message.
  lines.push("", dt(lang, "wa_thanks"), "", dt(lang, "wa_footer"));
  return lines.join("\n");
}

/** The reminder. Only meaningful when a balance is due; callers check first. */
export function reminderMessage(lang: DiaryLang, b: DiaryMessageInput): string {
  const due = balanceDue(b.totalAmount, b.amountReceived) ?? 0;
  return [
    `*${b.hallName}*`,
    dt(lang, "wa_reminder"),
    "",
    dt(lang, "wa_reminderLine", {
      amount: formatAmount(due),
      dates: formatDiaryDates(lang, b.eventDate, b.endDate, { year: true }),
    }),
    "",
    dt(lang, "wa_thanks"),
  ].join("\n");
}

// ── Shapes the page hands the screen ─────────────────────────────────────────

/** One of the venue's own bookings, as the diary shows it. */
export type DiaryBooking = {
  id: string;
  eventDate: string;
  endDate: string;
  slot: DiarySlot;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  totalAmount: number | null;
  amountReceived: number | null;
};

/** A booking a customer made and paid for on Hallnect. Read-only in the diary. */
export type DiaryOnline = {
  id: string;
  eventDate: string;
  endDate: string;
  slot: DiarySlot;
};

// ── Month keys ("2026-10") — string arithmetic, never Date in local time ─────

export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function addMonthsToKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Last day of the month, e.g. "2026-02" → "2026-02-28". */
export function monthEndIso(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}

export function formatMonthTitle(lang: DiaryLang, key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (lang === "ta") return `${TAMIL_MONTHS[m - 1]} ${y}`;
  const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${full[m - 1]} ${y}`;
}

/** "Sun" / "ஞாயிறு" — the weekday alone, for the date badge in the list. */
export function formatWeekday(lang: DiaryLang, iso: string): string {
  const { wd } = parts(iso);
  return lang === "ta" ? TAMIL_WEEKDAYS[wd] : EN_WEEKDAYS[wd];
}
