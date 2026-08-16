"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/Button";
import { type OwnerAmenity, type OwnerHallDetail } from "@/lib/owner";
import { createHall, updateHall } from "@/app/owner/(dashboard)/actions";
import { normalizeAmenityName, CUSTOM_AMENITY_LIMITS } from "@/lib/validation/schemas";

interface Props {
  ownerId:    string;
  amenities:  OwnerAmenity[];
  hall?:      OwnerHallDetail; // present in edit mode
}

// Tamil Nadu cities/areas only — Hallnect's current service area.
const CITIES = [
  "Madurai", "Chennai", "Coimbatore", "Tiruchirappalli", "Salem",
  "Tirunelveli", "Thanjavur", "Dindigul", "Erode", "Tiruppur",
  "Vellore", "Kanchipuram", "Sivakasi", "Virudhunagar", "Karaikudi",
  "Rajapalayam", "Pollachi", "Chengalpattu",
];

export function HallForm({ ownerId, amenities, hall }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name,         setName]         = useState(hall?.name          ?? "");
  const [city,         setCity]         = useState(hall?.city          ?? "");
  const [state,        setState]        = useState(hall?.state         ?? "");
  const [address,      setAddress]      = useState(hall?.address       ?? "");
  const [pincode,      setPincode]      = useState(hall?.pincode       ?? "");
  const [capMin,       setCapMin]       = useState(String(hall?.capacity_min  ?? ""));
  const [capMax,       setCapMax]       = useState(String(hall?.capacity_max  ?? ""));
  const [priceDay,     setPriceDay]     = useState(String(hall?.price_per_day ?? ""));
  const [priceMorn,    setPriceMorn]    = useState(String(hall?.price_morning ?? ""));
  const [priceEven,    setPriceEven]    = useState(String(hall?.price_evening ?? ""));
  const [description,  setDescription]  = useState(hall?.description   ?? "");
  const [selectedAms,  setSelectedAms]  = useState<Set<string>>(new Set(hall?.amenity_ids ?? []));
  // Custom amenities live in form state and are saved with the hall, so they
  // follow the normal approval flow rather than publishing on their own.
  const [customAms,    setCustomAms]    = useState<string[]>(hall?.custom_amenities ?? []);
  const [customDraft,  setCustomDraft]  = useState("");
  const [customError,  setCustomError]  = useState<string | null>(null);

  function toggleAmenity(id: string) {
    setSelectedAms((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addCustomAmenity() {
    const clean = normalizeAmenityName(customDraft);
    setCustomError(null);

    if (clean.length < CUSTOM_AMENITY_LIMITS.minLength) {
      setCustomError(`Enter at least ${CUSTOM_AMENITY_LIMITS.minLength} characters.`); return;
    }
    if (clean.length > CUSTOM_AMENITY_LIMITS.maxLength) {
      setCustomError(`Keep it under ${CUSTOM_AMENITY_LIMITS.maxLength} characters.`); return;
    }
    if (customAms.length >= CUSTOM_AMENITY_LIMITS.maxPerHall) {
      setCustomError(`You can add up to ${CUSTOM_AMENITY_LIMITS.maxPerHall} custom amenities.`); return;
    }
    const key = clean.toLowerCase();
    if (customAms.some((c) => c.toLowerCase() === key)) {
      setCustomError("This amenity already exists."); return;
    }
    if (amenities.some((a) => a.name.trim().toLowerCase() === key)) {
      setCustomError("That's already a standard amenity — tick it above instead."); return;
    }
    setCustomAms((prev) => [...prev, clean]);
    setCustomDraft("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const data = {
      ownerId,
      name, city, state, address, pincode,
      capacityMin:  capMin,
      capacityMax:  capMax,
      pricePerDay:  priceDay,
      priceMorning: priceMorn,
      priceEvening: priceEven,
      description,
      amenityIds: [...selectedAms],
      customAmenities: customAms,
    };
    startTransition(async () => {
      const result = hall
        ? await updateHall(hall.id, data)
        : await createHall(data);
      if ("error" in result) {
        setError(result.error);
      } else if (hall) {
        router.push("/owner/halls");
      }
      // createHall does a server-side redirect on success
    });
  }

  const isEdit = !!hall;

  // Group amenities by category
  const grouped = amenities.reduce<Record<string, OwnerAmenity[]>>((acc, a) => {
    const cat = a.category ?? "Other";
    (acc[cat] = acc[cat] ?? []).push(a);
    return acc;
  }, {});

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Basic info */}
      <FormSection title="Basic Information">
        <Field label="Hall Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grand Palace Banquet Hall" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City *">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-maroon-500"
              required
            >
              <option value="">Select city</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="State">
            <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Tamil Nadu" />
          </Field>
        </div>
        <Field label="Address">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Full address of the venue"
            rows={2}
            className="block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-maroon-500 resize-none"
          />
        </Field>
        <Field label="Pincode">
          <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="600001" maxLength={6} />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the venue — ambience, specialities, what makes it unique…"
            rows={4}
            className="block w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-maroon-500 resize-none"
          />
        </Field>
      </FormSection>

      {/* Capacity */}
      <FormSection title="Capacity">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum Guests">
            <Input type="number" min={1} value={capMin} onChange={(e) => setCapMin(e.target.value)} placeholder="e.g. 50" />
          </Field>
          <Field label="Maximum Guests *">
            <Input type="number" min={1} value={capMax} onChange={(e) => setCapMax(e.target.value)} placeholder="e.g. 500" required />
          </Field>
        </div>
      </FormSection>

      {/* Pricing */}
      <FormSection title="Pricing (₹)">
        <Field label="Full Day Price *">
          <Input type="number" min={0} step={100} value={priceDay} onChange={(e) => setPriceDay(e.target.value)} placeholder="e.g. 150000" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Morning Slot (optional)">
            <Input type="number" min={0} step={100} value={priceMorn} onChange={(e) => setPriceMorn(e.target.value)} placeholder="e.g. 75000" />
          </Field>
          <Field label="Evening Slot (optional)">
            <Input type="number" min={0} step={100} value={priceEven} onChange={(e) => setPriceEven(e.target.value)} placeholder="e.g. 85000" />
          </Field>
        </div>
        <p className="text-[11px] text-charcoal-500">
          Advance payment (25%) is collected automatically at booking.
          Platform fee (5%) applies on top of these prices.
        </p>
      </FormSection>

      {/* Amenities */}
      {amenities.length > 0 && (
        <FormSection title="Amenities">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">{cat}</p>
              <div className="flex flex-wrap gap-2">
                {items.map((a) => {
                  const checked = selectedAms.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAmenity(a.id)}
                      className={[
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        checked
                          ? "border-maroon-500 bg-maroon-50 text-maroon-700"
                          : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
                      ].join(" ")}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </FormSection>
      )}

      {/* Custom amenities — owner-defined, unique to this hall */}
      <FormSection title="Custom Amenities">
        <p className="text-xs text-charcoal-500">
          Add facilities unique to your venue. These are reviewed with your hall
          before they go live. ({customAms.length}/{CUSTOM_AMENITY_LIMITS.maxPerHall})
        </p>

        {customAms.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {customAms.map((name) => (
              <li key={name.toLowerCase()}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300 bg-gold-50 py-1 pl-3 pr-1 text-xs font-medium text-charcoal-800">
                  <Sparkles className="h-3 w-3 shrink-0 text-gold-600" aria-hidden />
                  {name}
                  <button
                    type="button"
                    onClick={() => setCustomAms((prev) => prev.filter((c) => c !== name))}
                    aria-label={`Remove ${name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-500 transition hover:bg-gold-100 hover:text-red-600 active:scale-95 motion-reduce:active:scale-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addCustomAmenity(); }
            }}
            maxLength={CUSTOM_AMENITY_LIMITS.maxLength}
            placeholder="e.g. Bridal Makeup Room"
            aria-label="Custom amenity name"
            className="min-h-[44px] flex-1 rounded-xl border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-maroon-400"
          />
          <button
            type="button"
            onClick={addCustomAmenity}
            disabled={customAms.length >= CUSTOM_AMENITY_LIMITS.maxPerHall}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white transition active:scale-[0.97] disabled:opacity-60 motion-reduce:active:scale-100"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        </div>

        {customError && <p className="mt-2 text-xs text-red-600">{customError}</p>}
      </FormSection>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="gold" isLoading={pending} disabled={pending}>
          {pending
            ? isEdit ? "Saving…" : "Creating…"
            : isEdit ? "Save Changes" : "Create Hall"}
        </Button>
        <button
          type="button"
          onClick={() => router.push("/owner/halls")}
          className="text-sm font-medium text-charcoal-600 hover:text-charcoal-900"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card space-y-4">
      <h3 className="font-serif text-sm font-semibold text-charcoal-900 border-b border-border pb-2">{title}</h3>
      {children}
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
