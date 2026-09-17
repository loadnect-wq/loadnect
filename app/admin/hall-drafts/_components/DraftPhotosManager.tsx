"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Photos on a SAVED, unclaimed listing: add, remove, reorder, change the cover.
//
// Lives on the existing "Waiting to be claimed" card rather than a new edit
// page — there is no admin edit page for a draft, and building one for photos
// alone would be a second hall-management screen. Changes are local until
// "Save photos", which goes through the same commitDraftPhotos as the Add a
// Hall form. Once a listing is claimed its photos belong to the owner, who
// manages them on their own hall's Photos page, so this panel is not offered.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/Button";
import { HallPhotosField } from "./HallPhotosField";
import { commitDraftPhotos, photosFromSavedUrls, revokePreview, type DraftPhoto } from "./draft-photos";

export function DraftPhotosManager({ draftId, hallName, photoUrls }: {
  draftId: string;
  hallName: string;
  photoUrls: string[];
}) {
  const router = useRouter();
  const initial = useMemo(() => photosFromSavedUrls(photoUrls), [photoUrls]);
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initialOrder = initial.map((p) => p.storagePath).join("|");
  const currentOrder = photos.map((p) => p.storagePath ?? `new:${p.key}`).join("|");
  const dirty = initialOrder !== currentOrder;

  function discard() {
    photos.forEach(revokePreview);
    setPhotos(photosFromSavedUrls(photoUrls));
    setProblem(null);
  }

  function save() {
    setProblem(null);
    startTransition(async () => {
      const r = await commitDraftPhotos(draftId, photos, setPhotos);
      router.refresh();
      if (r.error || r.failedCount > 0) {
        setProblem(
          r.error && r.failedCount === 0
            ? r.error
            : `${r.failedCount} photo${r.failedCount === 1 ? "" : "s"} could not be saved — each one says why. ` +
              "Save again to retry, or remove them.",
        );
        return;
      }
      toast({ title: "Photos saved", description: `${hallName} now has ${r.savedCount} photo${r.savedCount === 1 ? "" : "s"}.`, variant: "success" });
    });
  }

  const cover = initial[0]?.previewUrl;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg text-xs font-semibold text-maroon-700 hover:underline"
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail of a public storage object
          <img src={cover} alt="" className="h-8 w-10 rounded object-cover ring-1 ring-border" />
        ) : (
          <Camera className="h-4 w-4" aria-hidden />
        )}
        Photos ({initial.length})
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-border bg-white p-3">
          <HallPhotosField photos={photos} onChange={setPhotos} disabled={pending} />

          {problem && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{problem}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="gold"
              size="sm"
              onClick={save}
              disabled={pending || (!dirty && !photos.some((p) => p.status === "failed"))}
            >
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              Save photos
            </Button>
            {dirty && !pending && (
              <button type="button" onClick={discard} className="text-xs font-semibold text-charcoal-600 hover:text-charcoal-900">
                Discard changes
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
