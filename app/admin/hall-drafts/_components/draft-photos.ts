// ─────────────────────────────────────────────────────────────────────────────
// The photo list an admin edits, and the one routine that saves it.
//
// Used by both places photos are managed — the Add a Hall form (after the
// listing is created) and the photo panel on a saved, unclaimed listing — so
// there is a single save path, not two that drift.
//
// ORDER IS THE MODEL. The list's first photo is the cover, exactly as
// admin_hall_drafts.photo_urls and claim_admin_hall_draft() treat it. "Set as
// cover" moves a photo to the front; there is no separate flag to disagree
// with the order.
// ─────────────────────────────────────────────────────────────────────────────

import { IMAGE_CACHE_CONTROL } from "@/lib/supabase/storage";
import { storagePathFromPublicUrl, type PhotoMime } from "@/lib/hall-draft-photos";
import { uploadToSignedUrl } from "@/lib/prepare-hall-photo";
import { prepareHallDraftPhotoUploads, saveHallDraftPhotos } from "../../actions";

export type DraftPhoto = {
  /** Stable React key. */
  key: string;
  /** Object URL for a local pick, public URL for a saved photo. */
  previewUrl: string;
  /** True when previewUrl is an object URL this list must revoke. */
  ownsPreview: boolean;
  name: string;
  /** Set once the file is in Storage. Null = not uploaded (or must re-upload). */
  storagePath: string | null;
  /** The prepared file, kept until it is saved so a failure can be retried. */
  blob: Blob | null;
  type: PhotoMime | null;
  /** name|size|lastModified of the original pick, to catch the same file twice. */
  fingerprint: string | null;
  status: "pending" | "uploading" | "saved" | "failed";
  progress: number;
  error: string | null;
};

export function photosFromSavedUrls(urls: readonly string[]): DraftPhoto[] {
  return urls.flatMap((url, i) => {
    const storagePath = storagePathFromPublicUrl(url);
    if (!storagePath) return [];
    return [{
      key: storagePath,
      previewUrl: url,
      ownsPreview: false,
      name: `Photo ${i + 1}`,
      storagePath,
      blob: null,
      type: null,
      fingerprint: null,
      status: "saved" as const,
      progress: 1,
      error: null,
    }];
  });
}

export function revokePreview(p: DraftPhoto) {
  if (p.ownsPreview) URL.revokeObjectURL(p.previewUrl);
}

type Update = (fn: (prev: DraftPhoto[]) => DraftPhoto[]) => void;

export type CommitResult = { savedCount: number; failedCount: number; error: string | null };

const UPLOAD_CONCURRENCY = 3;

/**
 * Uploads every photo that is not in Storage yet, then saves the complete
 * ordered list. Photos that fail are marked on their own tile with the reason
 * and keep their file, so saving again retries exactly those.
 */
export async function commitDraftPhotos(
  draftId: string,
  snapshot: readonly DraftPhoto[],
  update: Update,
): Promise<CommitResult> {
  const patch = (key: string, changes: Partial<DraftPhoto>) =>
    update((prev) => prev.map((p) => (p.key === key ? { ...p, ...changes } : p)));

  const pathByKey = new Map<string, string>();
  for (const p of snapshot) if (p.storagePath) pathByKey.set(p.key, p.storagePath);

  const toUpload = snapshot.filter((p) => !p.storagePath && p.blob && p.type);
  const uploadFailed = new Set<string>();

  if (toUpload.length > 0) {
    for (const p of toUpload) patch(p.key, { status: "uploading", progress: 0, error: null });

    let prepared: Awaited<ReturnType<typeof prepareHallDraftPhotoUploads>>;
    try {
      prepared = await prepareHallDraftPhotoUploads({
        draftId,
        files: toUpload.map((p) => ({ key: p.key, type: p.type!, size: p.blob!.size })),
      });
    } catch {
      prepared = { error: "Could not reach the server. Check the connection and try again." };
    }

    if ("error" in prepared) {
      for (const p of toUpload) {
        uploadFailed.add(p.key);
        patch(p.key, { status: "failed", progress: 0, error: prepared.error });
      }
    } else {
      const slots = new Map(prepared.uploads.map((u) => [u.key, u]));
      const queue = [...toUpload];
      const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const slot = slots.get(p.key);
          if (!slot) {
            uploadFailed.add(p.key);
            patch(p.key, { status: "failed", error: "No upload slot was issued. Try again." });
            continue;
          }
          const key = p.key;
          try {
            await uploadToSignedUrl(slot.signedUrl, p.blob!, p.type!, IMAGE_CACHE_CONTROL, (f) =>
              patch(key, { progress: f }),
            );
            pathByKey.set(key, slot.path);
          } catch (e) {
            uploadFailed.add(key);
            patch(key, {
              status: "failed",
              progress: 0,
              error: e instanceof Error ? e.message : "The upload failed. Try again.",
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, toUpload.length) }, worker));
    }
  }

  // The list to keep, in the admin's order, without photos that did not upload.
  const ordered = snapshot
    .filter((p) => !uploadFailed.has(p.key))
    .map((p) => pathByKey.get(p.key))
    .filter((path): path is string => Boolean(path));
  const newlyUploaded = toUpload.filter((p) => pathByKey.has(p.key)).map((p) => p.key);

  let saved: Awaited<ReturnType<typeof saveHallDraftPhotos>>;
  try {
    saved = await saveHallDraftPhotos({ draftId, paths: ordered, discard: [] });
  } catch {
    saved = { error: "Could not reach the server. Check the connection and try again." };
  }

  if ("error" in saved) {
    // The server removed this save's uploads, so they must be uploaded again.
    for (const key of newlyUploaded) {
      patch(key, { status: "failed", storagePath: null, progress: 0, error: saved.error });
    }
    return { savedCount: 0, failedCount: uploadFailed.size + newlyUploaded.length, error: saved.error };
  }

  const rejected = new Map(saved.rejected.map((r) => [r.path, r.reason]));
  update((prev) =>
    prev.map((p) => {
      const path = pathByKey.get(p.key);
      if (!path || uploadFailed.has(p.key)) return p;
      const reason = rejected.get(path);
      if (reason) return { ...p, status: "failed", storagePath: null, progress: 0, error: reason };
      // Saved: the local file is no longer needed.
      return { ...p, status: "saved", storagePath: path, progress: 1, error: null, blob: null };
    }),
  );

  return {
    savedCount: saved.saved.length,
    failedCount: uploadFailed.size + saved.rejected.length,
    error: null,
  };
}
