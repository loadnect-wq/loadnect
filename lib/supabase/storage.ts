// ─────────────────────────────────────────────────────────────────────────────
// lib/supabase/storage.ts — Hall image upload/delete utilities.
//
// USE IN:  Client Components that handle image uploads.
// Uploads go directly from the browser to Supabase Storage (no server hop).
// Storage RLS ensures only the hall owner (or admin) can write.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from "./client";

export const BUCKET = "hall-images";

/**
 * The canonical public URL for an object in the hall-images bucket.
 *
 * EXISTS SO THE SERVER NEVER HAS TO TRUST A CLIENT-SUPPLIED URL. addHallImage
 * used to take `url` and `storagePath` as two separate client fields and check
 * only the path — so an owner could upload a real image to their own folder and
 * register ANY http(s) address as the picture, and hall_images.url would point
 * wherever they liked.
 *
 * Deriving it from the path removes the mismatch rather than policing it: there
 * is now only one field the client controls, and it is already constrained to
 * `<hallId>/...`. A validator has to anticipate every way two values can
 * disagree; a derivation cannot disagree at all.
 *
 * Pure string building — safe on the server, no client and no network.
 */
export function publicUrlForStoragePath(storagePath: string): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const clean = storagePath.replace(/^\/+/, "");
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

/**
 * One year, against Supabase Storage's one-HOUR default.
 *
 * EGRESS IS THE METER THAT FILLS FIRST on this project — venue photos are the
 * largest thing the site serves, and they are served on every hall card and
 * gallery view. At the default `cacheControl: 3600` a returning visitor
 * re-downloads every photo they saw an hour ago, so the same bytes are billed
 * over and over for images that never change.
 *
 * Safe because these objects are IMMUTABLE by construction: the filename is a
 * fresh crypto.randomUUID() and every upload uses `upsert: false`, so a given
 * URL's bytes can never be replaced. Editing a hall's photo uploads a new
 * object at a new URL; deleting removes it. There is no version of this where a
 * cached copy goes stale.
 *
 * Applies only to objects uploaded AFTER this shipped — Supabase stamps
 * Cache-Control at upload time, so anything already in the bucket keeps its
 * one-hour TTL until it is re-uploaded.
 */
export const IMAGE_CACHE_CONTROL = "31536000"; // seconds; 365 days
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

/**
 * What the file ACTUALLY is, read from its first bytes, or null.
 *
 * validateImageFile checks file.type and the filename extension, and BOTH ARE
 * CLIENT-DECLARED: `new File([payload], "x.png", { type: "image/png" })` sets
 * them to whatever the caller likes, and the browser never looks inside. So the
 * only thing standing between the bucket and an arbitrary payload served from
 * our own storage domain was a string the uploader chose.
 *
 * The practical risk is bounded — Supabase serves these objects with the
 * content type recorded at upload, and the CSP does not let hallnect.com
 * execute them — but "our domain hosts a file that claims to be a photo and is
 * not" is not a thing to leave to the uploader's honesty, and both of those
 * mitigations live in other systems.
 *
 * Signatures, all at offset 0 except WebP's second half:
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" .... "WEBP"   (bytes 0-3 and 8-11)
 */
export async function sniffImageType(file: File): Promise<"image/jpeg" | "image/png" | "image/webp" | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return "image/png";
  }
  if (head.length >= 12) {
    const tag = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
    if (tag(0, 4) === "RIFF" && tag(8, 12) === "WEBP") return "image/webp";
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

  // AND WHAT IT ACTUALLY IS. The checks above read a declared type and a
  // filename; this one reads the file. A mismatch is rejected rather than
  // corrected, because a .png whose bytes are a JPEG is at best a confused
  // client and at worst a deliberate one, and neither is worth guessing for.
  const actual = await sniffImageType(file);
  if (!actual) {
    throw new Error("That file is not a JPG, PNG or WebP image.");
  }
  if (actual !== file.type) {
    throw new Error(`That file says it is ${file.type} but its contents are ${actual}. Re-save it and try again.`);
  }

  const supabase = getSupabaseClient();
  const ext = getExtension(file.name);
  const safeName = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${hallId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      // The SNIFFED type, never the declared one — this is the header Supabase
      // serves the object with.
      contentType: actual,
      upsert: false,
      cacheControl: IMAGE_CACHE_CONTROL,
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

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES };  // BUCKET is exported at its declaration
