"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { VENUE_TYPE_VALUES } from "@/lib/validation/schemas";
import { createAdminHallDraft, checkHallDraftDuplicates } from "../../actions";

type Match = { kind: "hall" | "draft"; id: string; name: string; city: string; reason: string; href: string | null };

const BLANK = {
  name: "", description: "", city: "", state: "Tamil Nadu", address: "", pincode: "",
  capacityMin: "", capacityMax: "", pricePerDay: "",
  bookingMode: "LEAD_GENERATION" as "LEAD_GENERATION" | "DIRECT_BOOKING",
  ownerName: "", ownerPhone: "", ownerEmail: "", adminNotes: "",
};

export function AddHallDraftForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...BLANK });
  const [venueTypes, setVenueTypes] = useState<string[]>([]);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once the admin has SEEN a duplicate warning and chosen to continue, so
  // the warning cannot be skipped by simply pressing Save twice quickly.
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    // Any edit invalidates a previous duplicate verdict — it was about a
    // different venue.
    setMatches(null);
    setAcknowledged(false);
  };

  async function runDuplicateCheck(): Promise<Match[]> {
    setChecking(true);
    try {
      const result = await checkHallDraftDuplicates({
        name: f.name, city: f.city, phone: f.ownerPhone, email: f.ownerEmail,
      });
      return "error" in result ? [] : result.matches;
    } finally {
      setChecking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      // WARN BEFORE WRITING, ONCE. Brief section 11 asks for a duplicate
      // warning, not a block: two venues can share a name in different cities
      // and an owner may legitimately list a second hall. So the first Save
      // surfaces what was found and stops; the second proceeds.
      if (!acknowledged) {
        const found = await runDuplicateCheck();
        if (found.length > 0) {
          setMatches(found);
          setAcknowledged(true);
          return;
        }
      }

      const result = await createAdminHallDraft({
        ...f,
        capacityMin: f.capacityMin === "" ? undefined : f.capacityMin,
        capacityMax: f.capacityMax,
        pricePerDay: f.pricePerDay === "" ? undefined : f.pricePerDay,
        priceMorning: undefined,
        priceEvening: undefined,
        venueTypes,
        amenitySlugs: [],
        customAmenities: [],
        photoUrls: [],
      });

      if ("error" in result) { setError(result.error); return; }

      toast({
        title: "Listing saved",
        description: `${f.name} is waiting for ${f.ownerName} to claim it.`,
        variant: "success",
      });
      setF({ ...BLANK });
      setVenueTypes([]);
      setMatches(null);
      setAcknowledged(false);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="gold" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" aria-hidden />
        Add Hall
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-base font-semibold text-charcoal-900">Add a hall</h2>
          <p className="mt-0.5 text-xs text-charcoal-500">
            For a venue whose owner has not registered yet. They claim it by signing in with the mobile number below.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-charcoal-400 hover:text-charcoal-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <fieldset disabled={pending} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Hall name" required value={f.name} onChange={set("name")} />
          <Field id="city" label="City" required value={f.city} onChange={set("city")} />
          <Field id="address" label="Address, area and district" value={f.address} onChange={set("address")}
                 hint="Area and district go here — the listing stores one address line." />
          <Field id="pincode" label="Pincode" value={f.pincode} onChange={set("pincode")} />
          <Field id="state" label="State" value={f.state} onChange={set("state")} />
          <Field id="capacityMax" label="Maximum guests" required type="number" value={f.capacityMax} onChange={set("capacityMax")} />
          <Field id="capacityMin" label="Minimum guests" type="number" value={f.capacityMin} onChange={set("capacityMin")} />
          <Field id="pricePerDay" label="Day rate (₹)" type="number" value={f.pricePerDay} onChange={set("pricePerDay")}
                 hint="Leave blank if unknown — enquiry listings do not need one." />
        </div>

        <div>
          <Label>How does this venue take business?</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(["LEAD_GENERATION", "DIRECT_BOOKING"] as const).map((m) => (
              <button
                key={m} type="button"
                onClick={() => setF((p) => ({ ...p, bookingMode: m }))}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  f.bookingMode === m
                    ? "border-maroon-400 bg-maroon-50 text-maroon-800"
                    : "border-border bg-white text-charcoal-600 hover:border-maroon-200",
                ].join(" ")}
              >
                {m === "LEAD_GENERATION" ? "Enquiries" : "Direct booking"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-charcoal-500">
            Enquiries is the safe default: nobody is maintaining this venue&apos;s calendar yet, and direct
            booking would take a deposit against dates no one has confirmed. Direct booking needs a day rate.
          </p>
        </div>

        <div>
          <Label>Event types</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {VENUE_TYPE_VALUES.map((t) => {
              const on = venueTypes.includes(t);
              return (
                <button
                  key={t} type="button"
                  onClick={() => setVenueTypes((p) => (on ? p.filter((x) => x !== t) : [...p, t]))}
                  className={[
                    "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    on ? "border-maroon-400 bg-maroon-50 text-maroon-800"
                       : "border-border bg-white text-charcoal-600 hover:border-maroon-200",
                  ].join(" ")}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description" rows={3} value={f.description} onChange={set("description")}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="What the venue actually offers. The owner can rewrite this after claiming."
          />
        </div>

        <div className="rounded-xl border border-border bg-ivory-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Owner contact</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field id="ownerName" label="Contact name" required value={f.ownerName} onChange={set("ownerName")} />
            <Field id="ownerPhone" label="Mobile number" required value={f.ownerPhone} onChange={set("ownerPhone")}
                   hint="This exact number is what unlocks the claim." />
            <Field id="ownerEmail" label="Email" type="email" value={f.ownerEmail} onChange={set("ownerEmail")} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">
            The owner claims this listing only after signing in and verifying this mobile number by OTP.
            Email is recorded for contact, but it does not unlock a claim on its own.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adminNotes">Internal notes</Label>
          <textarea
            id="adminNotes" rows={2} value={f.adminNotes} onChange={set("adminNotes")}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Only visible to admins."
          />
        </div>
      </fieldset>

      {matches && matches.length > 0 && (
        <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Possible existing Hallnect listing found
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-amber-900">
            {matches.map((m) => (
              <li key={`${m.kind}-${m.id}`}>
                <span className="font-medium">{m.name}</span> — {m.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-900/80">
            Review these first. If this really is a different venue, press Save again to continue.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" variant="gold" disabled={pending || checking}>
          {(pending || checking) && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          {acknowledged && matches && matches.length > 0 ? "Save anyway" : "Save listing"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-charcoal-500 hover:text-charcoal-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  id, label, value, onChange, required, type = "text", hint,
}: {
  id: string; label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; type?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{required && <span className="text-maroon-600"> *</span>}
      </Label>
      <Input id={id} type={type} value={value} onChange={onChange} required={required} />
      {hint && <p className="text-[11px] leading-relaxed text-charcoal-500">{hint}</p>}
    </div>
  );
}
