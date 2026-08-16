"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Sparkles, Star, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/Button";
import { type OwnerAmenity, type OwnerHallDetail } from "@/lib/owner";
import { createHall, updateHall } from "@/app/owner/(dashboard)/actions";
import { normalizeAmenityName, CUSTOM_AMENITY_LIMITS, validateImageFile } from "@/lib/validation/schemas";
import { getSupabaseClient } from "@/lib/supabase/client";
import { addHallImage } from "@/app/owner/(dashboard)/actions";

// Extension comes from the validated MIME type, never the untrusted filename.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

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

  // Photos chosen in THIS form. They are local previews until the hall exists —
  // a hall id is required before an image can be permanently associated, so the
  // upload happens immediately after createHall returns (see handleSubmit).
  const [photos, setPhotos] = useState<{ key: string; file: File; preview: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

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

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setPhotoError(null);
    const accepted: typeof photos = [];
    for (const file of picked) {
      const check = validateImageFile(file);
      if (!check.ok) { setPhotoError(`${file.name}: ${check.error}`); continue; }
      accepted.push({ key: `${Date.now()}-${file.name}-${accepted.length}`, file, preview: URL.createObjectURL(file) });
    }
    setPhotos((prev) => [...prev, ...accepted]);
    if (photoRef.current) photoRef.current.value = "";
  }

  function removePhoto(key: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  /** Uploads the chosen photos against a real hall id. Returns how many landed. */
  async function uploadPhotos(hallId: string): Promise<{ uploaded: number; failed: number }> {
    const supabase = getSupabaseClient();
    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < photos.length; i++) {
      const { file } = photos[i];
      setUploadNote(`Uploading photo ${i + 1} of ${photos.length}…`);
      const ext  = EXT_BY_MIME[file.type] ?? "jpg";
      const path = `${hallId}/${crypto.randomUUID()}.${ext}`;
      try {
        const { error: sErr } = await supabase.storage
          .from("hall-images").upload(path, file, { upsert: false, contentType: file.type });
        if (sErr) throw new Error(sErr.message);

        const { data: urlData } = supabase.storage.from("hall-images").getPublicUrl(path);
        const res = await addHallImage({
          hallId, url: urlData.publicUrl, storagePath: path,
          isCover: i === 0, altText: "",
        });
        if ("error" in res) {
          // Never leave an object with no row behind it.
          await supabase.storage.from("hall-images").remove([path]).catch(() => {});
          throw new Error(res.error);
        }
        uploaded += 1;
      } catch {
        failed += 1;
      }
    }
    setUploadNote(null);
    return { uploaded, failed };
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

      if ("error" in result) { setError(result.error); return; }

      if (hall) {
        router.push("/owner/halls");
        return;
      }

      // New hall: the record now exists, so photos can be attached to it.
      const newId = result.id;
      if (!newId) { setError("Hall was created but its reference is missing. Open My Halls to continue."); return; }

      if (photos.length > 0) {
        const { failed } = await uploadPhotos(newId);
        if (failed > 0) {
          // Carry the failure in the URL. setError() here would be pointless:
          // the navigation below unmounts this component immediately, so the
          // banner would never render and the owner would never learn that
          // photos were lost.
          router.push(`/owner/halls/${newId}/images?failed=${failed}&of=${photos.length}`);
          return;
        }
      }

      router.push(`/owner/halls/${newId}/images?submitted=1`);
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

      {/* Hall photos — part of THIS form; uploaded the moment the hall exists */}
      {!isEdit && (
        <FormSection title="Hall Photos">
          <p className="text-xs text-charcoal-500">
            Add photos of your venue. The first photo becomes the cover customers see.
            JPEG, PNG or WebP, up to 5 MB each.
          </p>

          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-white px-6 py-8 transition-colors hover:border-maroon-400 hover:bg-maroon-50/30"
          >
            <ImagePlus className="h-7 w-7 text-charcoal-400" aria-hidden />
            <span className="text-sm font-medium text-charcoal-700">Upload photos</span>
            <span className="text-xs text-charcoal-500">You can select several at once</span>
          </button>
          <input
            ref={photoRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handlePhotoPick}
          />

          {photoError && <p className="mt-2 text-xs text-red-600">{photoError}</p>}

          {photos.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p, i) => (
                <div key={p.key} className="relative overflow-hidden rounded-2xl bg-charcoal-100">
                  <div className="aspect-[4/3] w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  </div>
                  {i === 0 && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      <Star className="h-2.5 w-2.5 fill-white" aria-hidden /> Cover
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/60 to-transparent p-1.5">
                    <button
                      type="button"
                      onClick={() => removePhoto(p.key)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-red-600 transition active:scale-95 motion-reduce:active:scale-100"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </FormSection>
      )}

      {/* Review — what will be submitted */}
      {!isEdit && (
        <FormSection title="Review">
          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <ReviewItem label="Hall name" value={name || "—"} />
            <ReviewItem label="Location" value={[city, state].filter(Boolean).join(", ") || "—"} />
            <ReviewItem label="Capacity" value={capMax ? `Up to ${capMax}` : "—"} />
            <ReviewItem label="Price / day" value={priceDay ? `₹${priceDay}` : "—"} />
            <ReviewItem label="Amenities" value={`${selectedAms.size} standard · ${customAms.length} custom`} />
            <ReviewItem label="Photos" value={photos.length === 1 ? "1 selected" : `${photos.length} selected`} />
          </dl>
          <p className="mt-3 rounded-xl bg-ivory-100 p-3 text-xs text-charcoal-600">
            Submitting sends your hall and photos to the Hallnect team for verification.
            It stays private until it is approved.
          </p>
        </FormSection>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3">
        {/* disabled while pending — blocks double-submit creating duplicate halls */}
        <Button type="submit" variant="gold" isLoading={pending} disabled={pending}>
          {pending
            ? (uploadNote ?? (isEdit ? "Saving…" : "Submitting…"))
            : isEdit ? "Save Changes" : "Submit Hall for Verification"}
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

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ivory-50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-charcoal-800">{value}</dd>
    </div>
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
