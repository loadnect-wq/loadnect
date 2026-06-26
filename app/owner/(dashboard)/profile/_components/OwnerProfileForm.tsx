"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/Button";
import { type OwnerRow } from "@/lib/owner";
import { upsertOwnerRow, updateOwnerProfileName } from "@/app/owner/(dashboard)/actions";

const STATES = [
  "Tamil Nadu", "Maharashtra", "Karnataka", "Telangana", "Kerala",
  "Andhra Pradesh", "Gujarat", "Rajasthan", "Delhi", "West Bengal",
  "Uttar Pradesh", "Madhya Pradesh", "Punjab", "Haryana", "Goa",
];

interface Props {
  ownerRow:  OwnerRow | null;
  fullName:  string | null;
  email:     string | null;
  phone:     string | null;
}

export function OwnerProfileForm({ ownerRow, fullName, email, phone }: Props) {
  const [pending1, start1] = useTransition();
  const [pending2, start2] = useTransition();
  const [err1, setErr1]    = useState<string | null>(null);
  const [err2, setErr2]    = useState<string | null>(null);
  const [ok1,  setOk1]    = useState(false);
  const [ok2,  setOk2]    = useState(false);

  // Profile fields
  const [name,  setName]  = useState(fullName  ?? "");
  const [phoneV, setPhoneV] = useState(phone   ?? "");

  // Business fields
  const [bizName,  setBizName]  = useState(ownerRow?.business_name  ?? "");
  const [bizEmail, setBizEmail] = useState(ownerRow?.business_email ?? "");
  const [bizPhone, setBizPhone] = useState(ownerRow?.business_phone ?? "");
  const [gst,      setGst]      = useState(ownerRow?.gst_number     ?? "");
  const [pan,      setPan]      = useState(ownerRow?.pan_number      ?? "");
  const [address,  setAddress]  = useState(ownerRow?.address         ?? "");
  const [city,     setCity]     = useState(ownerRow?.city            ?? "");
  const [state,    setState]    = useState(ownerRow?.state           ?? "");
  const [upi,      setUpi]      = useState(ownerRow?.payout_upi      ?? "");

  function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setErr1(null); setOk1(false);
    start1(async () => {
      const r = await updateOwnerProfileName({ fullName: name, phone: phoneV });
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
        businessPhone: bizPhone,
        gstNumber:     gst,
        panNumber:     pan,
        address,
        city,
        state,
        payoutUpi:     upi,
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
          <p className="text-[11px] text-charcoal-500 mt-1">Email is managed by Hallnect and cannot be changed here.</p>
        </Field>
        <Field label="Phone">
          <Input value={phoneV} onChange={(e) => setPhoneV(e.target.value)} placeholder="+91 98765 43210" type="tel" />
        </Field>

        <Button type="submit" variant="gold" size="sm" isLoading={pending1} disabled={pending1}>
          Save Account
        </Button>
      </form>

      {/* Business details */}
      <form onSubmit={handleBusinessSave} className="rounded-2xl bg-white shadow-card p-5 space-y-4">
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
          <Field label="Business Phone">
            <Input type="tel" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} placeholder="+91 …" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST Number">
            <Input value={gst} onChange={(e) => setGst(e.target.value)} placeholder="22AAAAA0000A1Z5" maxLength={15} />
          </Field>
          <Field label="PAN Number">
            <Input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="AAAAA1234A" maxLength={10} />
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
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" />
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
        <Field label="UPI ID for Payouts">
          <Input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@upi" />
          <p className="text-[11px] text-charcoal-500 mt-1">Payouts are sent here after each completed booking.</p>
        </Field>

        <Button type="submit" variant="gold" size="sm" isLoading={pending2} disabled={pending2}>
          Save Business Profile
        </Button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-charcoal-700">{label}</Label>
      {children}
    </div>
  );
}
