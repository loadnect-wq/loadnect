"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/Button";
import { type OwnerAmenity, type OwnerHallDetail } from "@/lib/owner";
import { createHall, updateHall } from "@/app/owner/(dashboard)/actions";

interface Props {
  ownerId:    string;
  amenities:  OwnerAmenity[];
  hall?:      OwnerHallDetail; // present in edit mode
}

const CITIES = [
  "Chennai", "Coimbatore", "Madurai", "Bangalore", "Hyderabad",
  "Kochi", "Mumbai", "Delhi", "Jaipur", "Pune", "Kolkata",
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

  function toggleAmenity(id: string) {
    setSelectedAms((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
