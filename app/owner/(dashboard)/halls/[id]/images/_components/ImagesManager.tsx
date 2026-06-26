"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Star, Trash2, Upload } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { type HallImage } from "@/lib/owner";
import { validateImageFile } from "@/lib/validation/schemas";
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

export function ImagesManager({ hallId, initial }: Props) {
  const [images, setImages]   = useState<HallImage[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const check = validateImageFile(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const supabase = getSupabaseClient();
      const ext  = file.name.split(".").pop() ?? "jpg";
      const path = `${hallId}/${crypto.randomUUID()}.${ext}`;

      const { error: storageErr } = await supabase.storage
        .from("hall-images")
        .upload(path, file, { upsert: false });

      if (storageErr) throw storageErr;

      const { data: urlData } = supabase.storage.from("hall-images").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const isCover = images.length === 0; // first image becomes cover
      const result  = await addHallImage({
        hallId,
        url:         publicUrl,
        storagePath: path,
        isCover,
        altText:     "",
      });

      if ("error" in result) throw new Error(result.error);

      // Optimistic update
      const newImg: HallImage = {
        id:           crypto.randomUUID(),
        url:          publicUrl,
        storage_path: path,
        alt_text:     null,
        is_cover:     isCover,
        sort_order:   images.length,
      };
      setImages((prev) => isCover ? [...prev, { ...prev[0], is_cover: false }, newImg].filter(Boolean) : [...prev, newImg]);
      // Reload from server for accuracy
      window.location.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleSetCover(imageId: string) {
    startTransition(async () => {
      const result = await setCoverImage(hallId, imageId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setImages((prev) => prev.map((img) => ({ ...img, is_cover: img.id === imageId })));
    });
  }

  async function confirmDelete(): Promise<void | string> {
    if (!deleteId) return;
    const result = await deleteHallImage(hallId, deleteId);
    if ("error" in result) return result.error;
    setImages((prev) => prev.filter((img) => img.id !== deleteId));
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Upload area */}
      <div
        onClick={() => fileRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-white px-6 py-10 hover:border-maroon-400 hover:bg-maroon-50/30 transition-colors"
      >
        {uploading ? (
          <>
            <Upload className="h-8 w-8 text-maroon-500 animate-bounce" />
            <p className="text-sm font-medium text-charcoal-600">Uploading…</p>
          </>
        ) : (
          <>
            <ImagePlus className="h-8 w-8 text-charcoal-400" />
            <div className="text-center">
              <p className="text-sm font-medium text-charcoal-700">Click to upload an image</p>
              <p className="mt-0.5 text-xs text-charcoal-500">JPEG, PNG, WebP · Max 5 MB</p>
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handleUpload}
          disabled={uploading}
        />
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img) => (
            <div
              key={img.id}
              className={[
                "group relative overflow-hidden rounded-2xl bg-charcoal-100",
                img.is_cover ? "ring-2 ring-gold-500" : "",
              ].join(" ")}
            >
              <div className="aspect-[4/3] w-full">
                <img
                  src={img.url}
                  alt={img.alt_text ?? "Hall image"}
                  className="h-full w-full object-cover"
                />
              </div>

              {img.is_cover && (
                <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  <Star className="h-2.5 w-2.5 fill-white" /> Cover
                </div>
              )}

              {/* Hover actions */}
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                {!img.is_cover && (
                  <button
                    type="button"
                    onClick={() => handleSetCover(img.id)}
                    disabled={pending}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-charcoal-800 hover:bg-gold-100 disabled:opacity-60"
                    title="Set as cover"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteId(img.id)}
                  disabled={pending}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-red-600 hover:bg-red-50 disabled:opacity-60"
                  title="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && !uploading && (
        <p className="text-center text-sm text-charcoal-500 py-4">
          No images yet. Upload at least one cover image.
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
