"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/Button";
import { type OwnerRow } from "@/lib/owner";
import { upsertOwnerRow, updateOwnerProfileName } from "@/app/owner/(dashboard)/actions";
import { BUSINESS_DETAILS_ID } from "./PayoutSetup";

// Hallnect serves Tamil Nadu only.
const STATES = ["Tamil Nadu"];

interface Props {
  ownerRow:  OwnerRow | null;
  fullName:  string | null;
  email:     string | null;
  phone:     string | null;
  initialNotificationsEnabled?: boolean;
}

export function OwnerProfileForm({ ownerRow, fullName, email, phone, initialNotificationsEnabled = true }: Props) {
  const [pending1, start1] = useTransition();
  const [pending2, start2] = useTransition();
  const [err1, setErr1]    = useState<string | null>(null);
  const [err2, setErr2]    = useState<string | null>(null);
  const [ok1,  setOk1]    = useState(false);
  const [ok2,  setOk2]    = useState(false);

  // Profile fields
  const [name,  setName]  = useState(fullName  ?? "");
  const [phoneV, setPhoneV] = useState(phone   ?? "");
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(initialNotificationsEnabled);

  // Business fields
  const [bizName,  setBizName]  = useState(ownerRow?.business_name  ?? "");
  const [bizEmail, setBizEmail] = useState(ownerRow?.business_email ?? "");
  const [bizPhone, setBizPhone] = useState(ownerRow?.business_phone ?? "");
  const [gst,      setGst]      = useState(ownerRow?.gst_number     ?? "");
  const [pan,      setPan]      = useState(ownerRow?.pan_number      ?? "");
  const [address,  setAddress]  = useState(ownerRow?.address         ?? "");
  const [city,     setCity]     = useState(ownerRow?.city            ?? "");
  const [state,    setState]    = useState(ownerRow?.state           ?? "");

  function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setErr1(null); setOk1(false);
    start1(async () => {
      const r = await updateOwnerProfileName({ fullName: name, phone: phoneV, notificationsEnabled: notifyEnabled });
      "error" in r ? setErr1(r.error) : setOk1(true);
    });
  }

  function handleBusinessSave(e: React.FormEvent) {
    e.preventDefault();
    setErr2(null); setOk2(false);
    if (!bizName.trim()) { setErr2("Business name is required"); return; }
    start2(async () => {
      const r = await upsertOwnerRow({
        businessName:  bizName,
        businessEmail: bizEmail,
        gstNumber:     gst,
        address,
        city,
        state,
      });
      "error" in r ? setErr2(r.error) : setOk2(true);
    });
  }

  return (
    <div className="space-y-5">

      {/* Account info */}
      <form onSubmit={handleProfileSave} className="rounded-2xl bg-white shadow-card p-5 space-y-4">
        <h3 className="font-serif text-sm font-semibold text-charcoal-900 border-b border-border pb-2">Account Details</h3>

        {err1 && <p className="text-sm text-red-700 rounded-xl bg-red-50 border border-red-200 px-3 py-2">{err1}</p>}
        {ok1  && <p className="flex items-center gap-1 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" /> Saved</p>}

        <Field label="Full Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
        </Field>
        <Field label="Email">
          <Input value={email ?? ""} disabled className="opacity-60 cursor-not-allowed" />
          {/* span, not p: Field now wraps its children in a <label>, whose
              content model is phrasing only. Rendered identically — Tailwind's
              preflight already zeroes p margins, and the vertical gap comes
              from the label's space-y either way. */}
          <span className="mt-1 block text-[11px] text-charcoal-500">Email is managed by Hallnect and cannot be changed here.</span>
        </Field>
        <Field label="Phone">
          <Input value={phoneV} onChange={(e) => setPhoneV(e.target.value)} placeholder="+91 98765 43210" type="tel" />
        </Field>

        {/* Notification preference — non-critical messages only */}
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-ivory-50 p-3">
          <div>
            <p className="text-xs font-semibold text-charcoal-800">SMS updates</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-charcoal-500">
              Optional text updates, when messaging is available. Your booking, payment and approval history is always on your dashboard.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notifyEnabled}
            aria-label="SMS updates"
            onClick={() => setNotifyEnabled((v) => !v)}
            className={
              "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors " +
              (notifyEnabled ? "bg-maroon-600" : "bg-charcoal-300")
            }
          >
            <span
              className={
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform " +
                (notifyEnabled ? "translate-x-[22px]" : "translate-x-0.5")
              }
            />
          </button>
        </div>

        <Button type="submit" variant="gold" size="sm" isLoading={pending1} disabled={pending1}>
          Save Account
        </Button>
      </form>

      {/* Business details */}
      {/* id is the scroll target the payout card jumps to when a required
          field is missing (see PayoutSetup.BUSINESS_DETAILS_ID). */}
      <form
        id={BUSINESS_DETAILS_ID}
        onSubmit={handleBusinessSave}
        className="scroll-mt-24 rounded-2xl bg-white shadow-card p-5 space-y-4 transition-shadow"
      >
        <h3 className="font-serif text-sm font-semibold text-charcoal-900 border-b border-border pb-2">
          Business Details
          {ownerRow?.is_verified && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verified
            </span>
          )}
        </h3>

        {err2 && <p className="text-sm text-red-700 rounded-xl bg-red-50 border border-red-200 px-3 py-2">{err2}</p>}
        {ok2  && <p className="flex items-center gap-1 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" /> Business profile saved</p>}

        <Field label="Business Name *">
          <Input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. ABC Events Pvt Ltd" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Business Email">
            <Input type="email" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} placeholder="biz@example.com" />
          </Field>
          <Field label="GST Number">
            <Input value={gst} onChange={(e) => setGst(e.target.value)} placeholder="22AAAAA0000A1Z5" maxLength={15} />
          </Field>
        </div>
        <Field label="Business Address">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            placeholder="Registered address"
            className="block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-maroon-500 resize-none"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madurai" />
          </Field>
          <Field label="State">
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-maroon-500"
            >
              <option value="">Select state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {/* Bank account, IFSC, PAN and the business phone are NOT here any
            more. They moved to the payout card at the top of this page, which
            saves them and registers the payout account in one action. Leaving
            them here as well would mean two places could write the same money
            fields, and saving this form would blank whatever the card stored. */}

        <Button type="submit" variant="gold" size="sm" isLoading={pending2} disabled={pending2}>
          Save Business Profile
        </Button>
      </form>
    </div>
  );
}

/**
 * THE LABEL WRAPS THE CONTROL. It used to be a sibling <Label> with no htmlFor
 * beside a control with no id, which ties the two to nothing. A screen reader
 * then falls back to whatever it can find: for most of these fields that is the
 * placeholder, so "Business Name *" was announced as "e.g. ABC Events Pvt Ltd"
 * — an example value read out as the field's name — and the two with nothing to
 * fall back on, the State select and the read-only Email, had no name at all.
 * Clicking the label text did not focus its field either.
 *
 * Wrapping rather than htmlFor/id: nine fields across the two forms on this
 * page would each need an id invented here and kept unique, and the wrapper
 * needs none. Same shape as the Field in ./PayoutSetup.tsx.
 *
 * The <span> is deliberately left inline, matching the inline <Label> it
 * replaces, so the label's line box and the 1.5 spacing below it are unchanged.
 * Anything else passed as a child lands inside the label, so hint text must be
 * phrasing content (a span, not a p).
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-charcoal-700">{label}</span>
      {children}
    </label>
  );
}
