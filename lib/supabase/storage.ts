// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/storage.ts — Hall image upload/delete utilities.
//
// USE IN:  Client Components that handle image uploads.
// Uploads go directly from the browser to Supabase Storage (no server hop).
// Storage RLS ensures only the hall owner (or admin) can write.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from "./client";

const BUCKET = "hall-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export type UploadResult = {
  storagePath: string;
  publicUrl: string;
};

function getExtension(filename: string): string {
  return (filename.split(".").pop() ?? "").toLowerCase();
}

export function validateImageFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return `Invalid file type "${file.type}". Allowed: JPG, PNG, WebP.`;
  }

  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Invalid extension ".${ext}". Allowed: .jpg, .jpeg, .png, .webp.`;
  }

  return null;
}

export async function uploadHallImage(
  hallId: string,
  file: File,
  options?: { isCover?: boolean; altText?: string; sortOrder?: number },
): Promise<UploadResult> {
  const error = validateImageFile(file);
  if (error) throw new Error(error);

  const supabase = getSupabaseClient();
  const ext = getExtension(file.name);
  const safeName = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${hallId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await supabase.from("hall_images" as any).insert({
    hall_id: hallId,
    url: publicUrl,
    storage_path: storagePath,
    alt_text: options?.altText ?? null,
    is_cover: options?.isCover ?? false,
    sort_order: options?.sortOrder ?? 0,
  } as any);

  if (dbError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw dbError;
  }

  return { storagePath, publicUrl };
}

export async function deleteHallImage(imageId: string, storagePath: string) {
  const supabase = getSupabaseClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await supabase
    .from("hall_images" as any)
    .delete()
    .eq("id", imageId);

  if (dbError) throw dbError;

  if (storagePath) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([storagePath]);

    if (storageError) throw storageError;
  }
}

export { BUCKET, MAX_FILE_SIZE, ALLOWED_MIME_TYPES };
