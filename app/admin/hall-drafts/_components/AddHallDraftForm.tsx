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
import { HallPhotosField } from "./HallPhotosField";
import { commitDraftPhotos, revokePreview, type DraftPhoto } from "./draft-photos";

type Match = { kind: "hall" | "draft"; id: string; name: string; city: string; reason: string; href: string | null };

const BLANK = {
  name: "", description: "", city: "", state: "Tamil Nadu", address: "", pincode: "",
  capacityMin: "", capacityMax: "", pricePerDay: "", priceMorning: "", priceEvening: "",
  bookingMode: "LEAD_GENERATION" as "LEAD_GENERATION" | "DIRECT_BOOKING",
  ownerName: "", ownerPhone: "", ownerEmail: "", adminNotes: "",
};

type AmenityOption = { id: string; name: string; slug: string };

export function AddHallDraftForm({ amenities = [] }: { amenities?: AmenityOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...BLANK });
  const [venueTypes, setVenueTypes] = useState<string[]>([]);
  // AMENITIES AND SLOT PRICES WERE HARD-CODED EMPTY. The schema, the
  // admin_hall_drafts table and claim_admin_hall_draft() have supported all
  // three since 0090 — the form simply never collected them, so every venue an
  // admin recorded claimed into a hall with NO amenities. Amenities are a
  // search filter and a published amenityFeature, so such a listing was
  // invisible in every filtered search the day its owner claimed it.
  const [amenitySlugs, setAmenitySlugs] = useState<string[]>([]);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once the admin has SEEN a duplicate warning and chosen to continue, so
  // the warning cannot be skipped by simply pressing Save twice quickly.
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // HALL PHOTOS. Picked and previewed locally; nothing is uploaded until Save
  // listing has created the listing, because until then there is no folder to
  // upload into and an abandoned form would leave files behind.
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  // Set once the listing exists but some photos still need attention. From
  // then on Save retries only the photos — pressing it again must never create
  // a second copy of the listing.
  const [savedDraft, setSavedDraft] = useState<{ id: string; name: string; ownerName: string } | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);

  function resetForm() {
    photos.forEach(revokePreview);
    setPhotos([]);
    setSavedDraft(null);
    setPhotoProblem(null);
    setF({ ...BLANK });
    setVenueTypes([]);
    setAmenitySlugs([]);
    setMatches(null);
    setAcknowledged(false);
    setError(null);
    setOpen(false);
  }

  /** Uploads and saves the photos for a listing that already exists. */
  async function finishPhotos(draft: { id: string; name: string; ownerName: string }, list: DraftPhoto[]) {
    const r = await commitDraftPhotos(draft.id, list, setPhotos);
    router.refresh();
    if (r.error || r.failedCount > 0) {
      setPhotoProblem(
        r.error && r.failedCount === 0
          ? r.error
          : `${r.failedCount} photo${r.failedCount === 1 ? "" : "s"} could not be saved — each one says why below. ` +
            "Press Save photos to try again, or remove them and finish.",
      );
      return;
    }
    toast({
      title: "Listing saved",
      description: `${draft.name} is waiting for ${draft.ownerName} to claim it` +
        (r.savedCount > 0 ? `, with ${r.savedCount} photo${r.savedCount === 1 ? "" : "s"}.` : "."),
      variant: "success",
    });
    resetForm();
  }

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
      // The listing already exists: only the photos are left to save.
      if (savedDraft) {
        setPhotoProblem(null);
        await finishPhotos(savedDraft, photos);
        return;
      }

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
        pricePerDay:  f.pricePerDay  === "" ? undefined : f.pricePerDay,
        priceMorning: f.priceMorning === "" ? undefined : f.priceMorning,
        priceEvening: f.priceEvening === "" ? undefined : f.priceEvening,
        venueTypes,
        amenitySlugs,
        customAmenities: [],
        // NO PHOTO URLS ON CREATE, AND THAT IS DELIBERATE. claim_admin_hall_draft()
        // copies photo_urls straight into hall_images, where CHECK
        // hall_images_url_is_our_storage (0083) requires our own bucket — so a
        // URL taken from the client here could fail weeks later, on the OWNER,
        // at the moment they claim. Photos arrive only through the uploader:
        // once this listing exists, finishPhotos() uploads them into its folder
        // and saveHallDraftPhotos checks each file before recording it (0094).
        photoUrls: [],
      });

      if ("error" in result) { setError(result.error); return; }

      // With photos, the listing is saved first and the photos go into its
      // folder. A photo failure is reported on the photo — the listing itself
      // is not rolled back, and the form says plainly that it was saved.
      if (photos.length > 0) {
        const draft = { id: result.draftId, name: f.name, ownerName: f.ownerName };
        setSavedDraft(draft);
        await finishPhotos(draft, photos);
        return;
      }

      toast({
        title: "Listing saved",
        description: `${f.name} is waiting for ${f.ownerName} to claim it.`,
        variant: "success",
      });
      setF({ ...BLANK });
      setVenueTypes([]);
      setAmenitySlugs([]);
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
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (savedDraft) resetForm();
            else setOpen(false);
          }}
          aria-label="Close"
          className="text-charcoal-400 hover:text-charcoal-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <fieldset disabled={pending || savedDraft !== null} className="space-y-4">
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

        {/* Amenities. A claimed venue with none is invisible in every filtered
            search and publishes no amenityFeature, so this is the field that
            most decides whether the listing works the day it goes live. */}
        {amenities.length > 0 && (
          <div>
            <Label>Amenities</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {amenities.map((a) => {
                const on = amenitySlugs.includes(a.slug);
                return (
                  <button
                    key={a.id} type="button"
                    onClick={() =>
                      setAmenitySlugs((p) => (on ? p.filter((x) => x !== a.slug) : [...p, a.slug]))
                    }
                    aria-pressed={on}
                    className={[
                      "min-h-[44px] rounded-full border px-3 text-xs font-medium transition-colors",
                      on ? "border-maroon-400 bg-maroon-50 text-maroon-800"
                         : "border-border bg-white text-charcoal-600 hover:border-maroon-200",
                    ].join(" ")}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-charcoal-500">
              Tick only what you have confirmed with the venue. The owner can correct these
              when they claim the listing.
            </p>
          </div>
        )}

        {/* Slot prices. The table and claim_admin_hall_draft() have carried
            these since 0090; the form just never asked. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="priceMorning">Morning rate (optional)</Label>
            <Input id="priceMorning" inputMode="numeric" value={f.priceMorning}
                   onChange={set("priceMorning")} placeholder="e.g. 60000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priceEvening">Evening rate (optional)</Label>
            <Input id="priceEvening" inputMode="numeric" value={f.priceEvening}
                   onChange={set("priceEvening")} placeholder="e.g. 90000" />
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
      </fieldset>

      {/* Hall photos — next to the description, before the owner's details. */}
      <fieldset disabled={pending} className="mt-4">
        <HallPhotosField photos={photos} onChange={setPhotos} disabled={pending} />
        {photoProblem && savedDraft && (
          <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">The listing was saved. Some photos were not.</p>
            <p className="mt-1 text-xs leading-relaxed">{photoProblem}</p>
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  const kept = photos.filter((p) => p.status !== "failed");
                  photos.filter((p) => p.status === "failed").forEach(revokePreview);
                  setPhotos(kept);
                  setPhotoProblem(null);
                  await finishPhotos(savedDraft, kept);
                })
              }
              className="mt-2 text-xs font-semibold underline underline-offset-2"
            >
              Remove the failed photos and finish
            </button>
          </div>
        )}
      </fieldset>

      <fieldset disabled={pending || savedDraft !== null} className="mt-4 space-y-4">
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
          {savedDraft ? "Save photos" : acknowledged && matches && matches.length > 0 ? "Save anyway" : "Save listing"}
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (savedDraft) router.refresh();
            resetForm();
          }}
          className="text-sm text-charcoal-500 hover:text-charcoal-800"
        >
          {savedDraft ? "Close" : "Cancel"}
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
