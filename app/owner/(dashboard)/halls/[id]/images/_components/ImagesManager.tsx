"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { type HallImage } from "@/lib/owner";
import { validateImageFile, IMAGE_LIMITS } from "@/lib/validation/schemas";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import {
  addHallImage,
  setCoverImage,
  deleteHallImage,
} from "@/app/owner/(dashboard)/actions";

interface Props {
  hallId: string;
  initial: HallImage[];
}

// Storage extension is derived from the validated MIME type, never from the
// user-supplied filename (a filename is untrusted input).
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

type QueueItem = {
  key:     string;
  name:    string;
  preview: string;                                   // object URL, local only
  status:  "uploading" | "done" | "error";
  error?:  string;
};

export function ImagesManager({ hallId, initial }: Props) {
  const router = useRouter();
  // `initial` is the server's authoritative list. We never shadow it with
  // optimistic copies — after any mutation we router.refresh() and re-render
  // from the database, so what's on screen is always what's persisted.
  const images = initial;

  const [queue, setQueue]     = useState<QueueItem[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = queue.some((q) => q.status === "uploading");

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);

    // Validate everything up front so one bad file doesn't half-upload a batch.
    const accepted: File[] = [];
    for (const file of files) {
      const check = validateImageFile(file);
      if (!check.ok) {
        setError(`${file.name}: ${check.error}`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const items: QueueItem[] = accepted.map((f, i) => ({
      key:     `${Date.now()}-${i}-${f.name}`,
      name:    f.name,
      preview: URL.createObjectURL(f),               // local preview, not "uploaded"
      status:  "uploading",
    }));
    setQueue((q) => [...q, ...items]);

    const supabase = getSupabaseClient();
    let coverTaken = images.length > 0;

    // Sequential: keeps ordering deterministic and avoids hammering storage.
    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      const item = items[i];
      const ext  = EXT_BY_MIME[file.type] ?? "jpg";
      const path = `${hallId}/${crypto.randomUUID()}.${ext}`;

      try {
        const { error: storageErr } = await supabase.storage
          .from("hall-images")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (storageErr) throw new Error(storageErr.message);

        const { data: urlData } = supabase.storage.from("hall-images").getPublicUrl(path);

        const result = await addHallImage({
          hallId,
          url:         urlData.publicUrl,
          storagePath: path,
          isCover:     !coverTaken,                  // first image overall becomes cover
          altText:     "",
        });

        if ("error" in result) {
          // The object uploaded but the row failed — remove the orphan so storage
          // and the database can't drift apart. Never report success here.
          await supabase.storage.from("hall-images").remove([path]).catch(() => {});
          throw new Error(result.error);
        }

        coverTaken = true;
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, status: "done" } : x)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, status: "error", error: message } : x)));
      }
    }

    if (fileRef.current) fileRef.current.value = "";
    // Pull the authoritative list back from the server, then drop finished items.
    startTransition(() => {
      router.refresh();
      setQueue((q) => q.filter((x) => x.status === "error"));
    });
  }

  function handleSetCover(imageId: string) {
    startTransition(async () => {
      const result = await setCoverImage(hallId, imageId);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  async function confirmDelete(): Promise<void | string> {
    if (!deleteId) return;
    const result = await deleteHallImage(hallId, deleteId);
    if ("error" in result) return result.error;
    router.refresh();
  }

  const maxMb = Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024));

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Upload area — tapping anywhere opens the picker (multiple files). */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-white px-6 py-10 transition-colors hover:border-maroon-400 hover:bg-maroon-50/30 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-maroon-500" />
            <p className="text-sm font-medium text-charcoal-600">Uploading…</p>
          </>
        ) : (
          <>
            <ImagePlus className="h-8 w-8 text-charcoal-400" />
            <div className="text-center">
              <p className="text-sm font-medium text-charcoal-700">Upload photos</p>
              <p className="mt-0.5 text-xs text-charcoal-500">
                JPEG, PNG, WebP · up to {maxMb} MB each · select multiple
              </p>
            </div>
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleFiles}
        disabled={busy}
      />

      {/* In-flight / failed uploads — a preview is NOT a saved image, so these
          are shown separately from the persisted grid below. */}
      {queue.length > 0 && (
        <ul className="space-y-2">
          {queue.map((q) => (
            <li key={q.key} className="flex items-center gap-3 rounded-xl border border-border bg-white p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-charcoal-800">{q.name}</p>
                <p className={[
                  "text-[11px]",
                  q.status === "error" ? "text-red-600" : "text-charcoal-500",
                ].join(" ")}>
                  {q.status === "uploading" ? "Uploading…" : q.status === "done" ? "Uploaded" : q.error}
                </p>
              </div>
              {q.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-maroon-500" />}
              {q.status === "done"      && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {q.status === "error"     && <AlertCircle className="h-4 w-4 text-red-600" />}
            </li>
          ))}
        </ul>
      )}

      {/* Saved images (server truth) */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img) => (
            <div
              key={img.id}
              className={[
                "relative overflow-hidden rounded-2xl bg-charcoal-100",
                img.is_cover ? "ring-2 ring-gold-500" : "",
              ].join(" ")}
            >
              <div className="aspect-[4/3] w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt_text ?? "Hall image"}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>

              {img.is_cover && (
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  <Star className="h-2.5 w-2.5 fill-white" /> Cover
                </div>
              )}

              {/* Actions are ALWAYS visible (44px targets). They used to be
                  hover-only, which made them unreachable on touch devices. */}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                {!img.is_cover && (
                  <button
                    type="button"
                    onClick={() => handleSetCover(img.id)}
                    disabled={pending}
                    aria-label="Set as cover image"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-charcoal-800 transition active:scale-95 disabled:opacity-60 motion-reduce:active:scale-100"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteId(img.id)}
                  disabled={pending}
                  aria-label="Delete image"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-red-600 transition active:scale-95 disabled:opacity-60 motion-reduce:active:scale-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && queue.length === 0 && (
        <p className="py-4 text-center text-sm text-charcoal-500">
          No photos yet. Your first upload becomes the cover image.
        </p>
      )}

      <ConfirmationDialog
        open={deleteId !== null}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete this image?"
        description="The image will be permanently removed from your listing. This cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
