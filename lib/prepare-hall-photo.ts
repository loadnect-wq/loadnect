// ─────────────────────────────────────────────────────────────────────────────
// lib/prepare-hall-photo.ts — make a picked photo ready to upload, in the
// browser. Client-only (createImageBitmap, canvas, XMLHttpRequest).
//
// There was no image pipeline to reuse: the owner uploaders send the file as
// picked, and the bucket refuses anything over 5 MB — which is most photos
// straight off a modern phone. So an admin adding a normal hall photograph
// would simply be told no. Here a large photo is scaled to 2560px on its long
// edge and re-encoded as a high-quality JPEG; a photo that already fits is
// uploaded byte-for-byte untouched, because re-encoding it would only lose
// quality.
//
// The TYPE is decided by the file's bytes, never its name or the type the
// browser reports (both are the uploader's to choose). The server checks the
// bytes again once the file is in Storage — this check is for a fast, specific
// message, not for security.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MAX_SOURCE_PHOTO_BYTES,
  MAX_STORED_PHOTO_BYTES,
  PHOTO_MIN_EDGE,
  planPhotoResize,
  sniffPhotoBytes,
  type PhotoMime,
} from "@/lib/hall-draft-photos";

export type PreparedPhoto = {
  blob: Blob;
  type: PhotoMime;
  width: number;
  height: number;
  resized: boolean;
};

export class PhotoRejected extends Error {}

const MB = 1024 * 1024;

export async function prepareHallPhoto(file: File): Promise<PreparedPhoto> {
  if (file.size === 0) throw new PhotoRejected("This file is empty.");
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    throw new PhotoRejected(
      `This file is ${(file.size / MB).toFixed(1)} MB. Photos up to ${MAX_SOURCE_PHOTO_BYTES / MB} MB can be added.`,
    );
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffPhotoBytes(head);
  if (!type) {
    // The common real case: an iPhone HEIC photo, or a PDF/screenshot tool export.
    throw new PhotoRejected("This is not a JPG, PNG or WebP image. HEIC and other formats need converting first.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoRejected("This image could not be opened. It may be damaged.");
  }

  try {
    const { width, height } = bitmap;
    if (Math.min(width, height) < PHOTO_MIN_EDGE) {
      throw new PhotoRejected(
        `This image is only ${width}×${height}px. Use a photo at least ${PHOTO_MIN_EDGE}px on its shorter side.`,
      );
    }

    const plan = planPhotoResize(width, height, file.size);
    if (!plan.resize) {
      return { blob: file, type, width, height, resized: false };
    }

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoRejected("This browser could not resize the photo.");
    // A transparent PNG would turn black as JPEG; hall photos are opaque, but
    // paint white underneath so a logo-style image cannot come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

    // Step quality down only if a very detailed photo is still too large.
    for (const quality of [0.88, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_STORED_PHOTO_BYTES) {
        return { blob, type: "image/jpeg", width: plan.width, height: plan.height, resized: true };
      }
    }
    throw new PhotoRejected("This photo is still larger than 5 MB after resizing. Try a smaller copy.");
  } finally {
    bitmap.close();
  }
}

/**
 * Uploads to a signed Storage upload URL with progress events — the supabase-js
 * helper uses fetch, which cannot report upload progress. Same request the
 * helper makes: a PUT of multipart form data carrying cacheControl and the file.
 */
export function uploadToSignedUrl(
  signedUrl: string,
  blob: Blob,
  type: PhotoMime,
  cacheControl: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", cacheControl);
    // The part's content type is what Storage records and serves.
    body.append("", blob instanceof File && blob.type === type ? blob : new Blob([blob], { type }));

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      // The body is Storage's own wording (it can name policies); keep it in
      // the console for support and give the admin a message by status.
      console.error(`[hall-draft-photos] upload failed (status=${xhr.status}):`, xhr.responseText);
      if (xhr.status === 413) reject(new Error("This photo is too large for storage."));
      else if (xhr.status === 415 || xhr.status === 400) reject(new Error("Storage refused this file type."));
      else if (xhr.status === 401 || xhr.status === 403) reject(new Error("The upload link expired. Try again."));
      else reject(new Error("The upload failed. Try again."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check the connection and try again."));
    xhr.ontimeout = () => reject(new Error("The upload timed out. Try again."));
    xhr.send(body);
  });
}
