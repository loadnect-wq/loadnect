import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_DRAFT_PHOTOS,
  MAX_STORED_PHOTO_BYTES,
  PHOTO_MAX_EDGE,
  diffPhotoLists,
  draftPhotoPath,
  isDraftPhotoPath,
  mimeForDraftPhotoPath,
  planPhotoResize,
  sniffPhotoBytes,
  storagePathFromPublicUrl,
} from "../hall-draft-photos";
import {
  IMAGE_LIMITS,
  prepareHallDraftPhotosSchema,
  saveHallDraftPhotosSchema,
} from "../validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Photos on an admin-recorded hall (migration 0094).
//
// Behaviour where it can run here (paths, sniffing, resize planning, audit
// diff, schemas), and source-level invariants for what only the database and
// Storage can enforce. Those were ALSO exercised against the live database as
// the admin, a non-admin owner, the claimant and anon, in a rolled-back
// transaction:
//   admin saves 2 photos                    1 row
//   admin saves a foreign url               refused by CHECK
//   admin points into another draft folder  refused by CHECK
//   non-admin / claimant edits photo_urls   0 rows (RLS)
//   claim copies photos                     storage_path set, first = cover, order kept
//   claimant may delete the folder's files  false before claim, true after
//   a different owner                       false
//   anon reads drafts                       permission denied
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const DRAFT = "3f0c6f1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const FILE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("photo paths", () => {
  it("are generated inside the draft's own folder", () => {
    expect(draftPhotoPath(DRAFT, FILE, "image/jpeg")).toBe(`${DRAFT}/${FILE}.jpg`);
    expect(draftPhotoPath(DRAFT, FILE, "image/webp")).toBe(`${DRAFT}/${FILE}.webp`);
  });

  it("accept only a generated name in THIS draft's folder", () => {
    expect(isDraftPhotoPath(DRAFT, `${DRAFT}/${FILE}.png`)).toBe(true);
    for (const bad of [
      `4a0c6f1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f/${FILE}.jpg`, // another draft or hall
      `${DRAFT}/../${FILE}.jpg`,
      `${DRAFT}/sub/${FILE}.jpg`,
      `${DRAFT}/holiday.jpg`,                           // a user-chosen name
      `${DRAFT}/${FILE}.svg`,
      `${DRAFT}/${FILE}.html`,
      `${DRAFT}/${FILE}.JPG`,
      `${DRAFT}/${FILE}.jpg.exe`,
      `/${DRAFT}/${FILE}.jpg`,
    ]) {
      expect(isDraftPhotoPath(DRAFT, bad), bad).toBe(false);
    }
    expect(isDraftPhotoPath("not-a-uuid", `not-a-uuid/${FILE}.jpg`)).toBe(false);
  });

  it("round-trip through the public URL the claim copies", () => {
    const url = `https://example.supabase.co/storage/v1/object/public/hall-images/${DRAFT}/${FILE}.jpg`;
    expect(storagePathFromPublicUrl(url)).toBe(`${DRAFT}/${FILE}.jpg`);
    expect(storagePathFromPublicUrl("https://evil.example/x.jpg")).toBeNull();
    expect(mimeForDraftPhotoPath(`${DRAFT}/${FILE}.png`)).toBe("image/png");
  });
});

describe("the file is what its bytes say", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(16).fill(0)]).slice(0, 16);
  const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

  it("recognises JPEG, PNG and WebP signatures", () => {
    expect(sniffPhotoBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffPhotoBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffPhotoBytes(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")))).toBe("image/webp");
  });

  it("refuses HTML, SVG, scripts, executables and HEIC renamed as photos", () => {
    expect(sniffPhotoBytes(bytes(...ascii("<!doctype html>")))).toBeNull();
    expect(sniffPhotoBytes(bytes(...ascii("<svg xmlns")))).toBeNull();
    expect(sniffPhotoBytes(bytes(...ascii("#!/bin/sh")))).toBeNull();
    expect(sniffPhotoBytes(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();            // Windows .exe
    expect(sniffPhotoBytes(bytes(0, 0, 0, 0x18, ...ascii("ftypheic")))).toBeNull(); // iPhone HEIC
    expect(sniffPhotoBytes(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")))).toBeNull();
  });
});

describe("resizing", () => {
  it("leaves a photo that already fits untouched", () => {
    expect(planPhotoResize(2000, 1500, 2 * 1024 * 1024)).toEqual({ resize: false });
    expect(planPhotoResize(PHOTO_MAX_EDGE, 1440, MAX_STORED_PHOTO_BYTES)).toEqual({ resize: false });
  });

  it("scales a large camera photo to the long-edge limit, keeping its shape", () => {
    expect(planPhotoResize(4032, 3024, 9 * 1024 * 1024)).toEqual({ resize: true, width: 2560, height: 1920 });
    expect(planPhotoResize(3024, 4032, 9 * 1024 * 1024)).toEqual({ resize: true, width: 1920, height: 2560 });
  });

  it("re-encodes a small-but-heavy file without enlarging it", () => {
    expect(planPhotoResize(1600, 1200, 7 * 1024 * 1024)).toEqual({ resize: true, width: 1600, height: 1200 });
  });
});

describe("the audit diff", () => {
  it("separates uploads, deletions, cover changes and reorders", () => {
    expect(diffPhotoLists([], ["a", "b"])).toEqual({ added: ["a", "b"], removed: [], reordered: false, coverChanged: true });
    expect(diffPhotoLists(["a", "b", "c"], ["a", "c"])).toEqual({ added: [], removed: ["b"], reordered: false, coverChanged: false });
    expect(diffPhotoLists(["a", "b", "c"], ["c", "a", "b"])).toMatchObject({ reordered: true, coverChanged: true });
    expect(diffPhotoLists(["a", "b"], ["a", "b", "d"])).toMatchObject({ reordered: false, coverChanged: false });
    expect(diffPhotoLists(["a", "b"], ["a", "b"])).toEqual({ added: [], removed: [], reordered: false, coverChanged: false });
  });
});

describe("limits agree everywhere", () => {
  it("10 photos, 5 MB stored — the bucket's own limit, reused", () => {
    expect(MAX_DRAFT_PHOTOS).toBe(10);
    expect(MAX_STORED_PHOTO_BYTES).toBe(IMAGE_LIMITS.maxBytes);
    const file = { key: "k", type: "image/jpeg", size: 1000 };
    const draftId = DRAFT;
    expect(prepareHallDraftPhotosSchema.safeParse({ draftId, files: Array(10).fill(0).map((_, i) => ({ ...file, key: `k${i}` })) }).success).toBe(true);
    expect(prepareHallDraftPhotosSchema.safeParse({ draftId, files: Array(11).fill(0).map((_, i) => ({ ...file, key: `k${i}` })) }).success).toBe(false);
    expect(prepareHallDraftPhotosSchema.safeParse({ draftId, files: [{ ...file, size: MAX_STORED_PHOTO_BYTES + 1 }] }).success).toBe(false);
    expect(prepareHallDraftPhotosSchema.safeParse({ draftId, files: [{ ...file, type: "image/svg+xml" }] }).success).toBe(false);
    expect(prepareHallDraftPhotosSchema.safeParse({ draftId, files: [{ ...file, type: "text/html" }] }).success).toBe(false);
    expect(saveHallDraftPhotosSchema.safeParse({ draftId, paths: Array(11).fill("x") }).success).toBe(false);
    expect(saveHallDraftPhotosSchema.safeParse({ draftId: "nope", paths: [] }).success).toBe(false);
  });

  it("the database refuses the same things (0094)", () => {
    const sql = read("supabase/migrations/0094_admin_hall_draft_photos.sql");
    // The limit itself was lowered from 20 to 10 by 0095.
    expect(read("supabase/migrations/0095_admin_hall_draft_photos_limit_10.sql")).toContain("coalesce(cardinality(_urls), 0) <= 10");
    expect(sql).toContain("check (public.admin_hall_draft_photo_urls_valid(photo_urls, id))");
    expect(sql).toMatch(/\\\.\(jpg\|png\|webp\)\$/);
  });
});

describe("the server actions", () => {
  const actions = read("app/admin/actions.ts");
  const fn = (name: string) => {
    const start = actions.indexOf(`export async function ${name}`);
    const next = actions.indexOf("\nexport async function", start + 10);
    return actions.slice(start, next === -1 ? undefined : next);
  };

  it("both start at the server-side admin gate", () => {
    for (const name of ["prepareHallDraftPhotoUploads", "saveHallDraftPhotos"]) {
      const body = fn(name);
      expect(body.indexOf("requireAdminActor()"), name).toBeGreaterThan(0);
      expect(body.indexOf("requireAdminActor()"), name).toBeLessThan(body.indexOf("parseSafe("));
    }
  });

  it("the server names every file — the client never chooses a path", () => {
    const body = fn("prepareHallDraftPhotoUploads");
    expect(body).toContain("draftPhotoPath(v.draftId, crypto.randomUUID(), f.type)");
    expect(body).toContain("createSignedUploadUrl(path)");
  });

  it("paths are checked before anything is read or removed", () => {
    const body = fn("saveHallDraftPhotos");
    expect(body.indexOf("isDraftPhotoPath(v.draftId, p)")).toBeLessThan(body.indexOf("readDraftForPhotos("));
  });

  it("every new file is checked where it landed: present, size, real bytes", () => {
    const body = fn("saveHallDraftPhotos");
    expect(body).toContain(".list(v.draftId");
    expect(body).toContain("size > MAX_STORED_PHOTO_BYTES");
    expect(body).toContain("sniffPhotoBytes(head)");
    expect(body).toContain("actual !== mimeForDraftPhotoPath(path)");
  });

  it("a claimed or withdrawn listing cannot have its photos changed", () => {
    expect(actions).toContain('data.claim_status === "claimed"');
    expect(fn("saveHallDraftPhotos")).toContain('.eq("claim_status", "unclaimed")');
  });

  it("guards against a concurrent edit, and refuses a zero-row write", () => {
    const body = fn("saveHallDraftPhotos");
    expect(body).toContain('.eq("updated_at", draft.updated_at)');
    expect(body).toContain('{ count: "exact" }');
    expect(body).toContain("(count ?? 0) === 0");
  });

  it("cleans up: failed saves, dropped photos, rejected files, stale uploads", () => {
    const body = fn("saveHallDraftPhotos");
    expect(body).toContain('removeDraftPhotoFiles(supabase, [...incoming, ...v.discard], "save failed")');
    expect(body).toContain("DRAFT_PHOTO_SWEEP_AFTER_MS");
    expect(body).toContain("const dropped = before.filter");
  });

  it("records upload, delete, cover change and reorder in the existing audit log", () => {
    const body = fn("saveHallDraftPhotos");
    for (const a of ["hall_draft.photo_upload", "hall_draft.photo_delete", "hall_draft.photo_cover_change", "hall_draft.photo_reorder"]) {
      expect(body).toContain(`"${a}"`);
    }
    expect(body).toContain("recordAdminAction(");
  });

  it("never returns a raw database or storage error", () => {
    const body = fn("saveHallDraftPhotos") + fn("prepareHallDraftPhotoUploads");
    expect(body).not.toMatch(/error:\s*(error|writeErr)\.message/);
    expect(body).toContain("sanitizeError(");
  });
});

describe("the Add a Hall form", () => {
  const form = read("app/admin/hall-drafts/_components/AddHallDraftForm.tsx");

  it("keeps every existing field", () => {
    for (const id of ["name", "city", "address", "pincode", "state", "capacityMax", "capacityMin", "pricePerDay",
                      "priceMorning", "priceEvening", "description", "ownerName", "ownerPhone", "ownerEmail", "adminNotes"]) {
      expect(form, id).toContain(`"${id}"`);
    }
    expect(form).toContain("How does this venue take business?");
    // Renamed from "Event types" in 0102, when the four hard-coded buttons
    // became the shared CategoryPicker the owner's own form uses. The label
    // matters less than the field still being there and still writing into
    // venueTypes, which the claim copies straight into halls.venue_types.
    expect(form).toContain("Suitable for");
    expect(form).toContain("<CategoryPicker");
    expect(form).toContain("venueTypes");
    expect(form).toContain("Amenities");
  });

  it("adds Hall Photos after the description and before the owner's details", () => {
    const desc = form.indexOf('htmlFor="description"');
    const photos = form.indexOf("<HallPhotosField");
    const owner = form.indexOf("Owner contact");
    expect(desc).toBeGreaterThan(0);
    expect(photos).toBeGreaterThan(desc);
    expect(owner).toBeGreaterThan(photos);
  });

  it("has one save button, which never creates the listing twice", () => {
    expect(form.match(/type="submit"/g)?.length).toBe(1);
    expect(form).toContain('"Save listing"');
    expect(form).toContain("if (savedDraft) {");
    const retry = form.slice(form.indexOf("if (savedDraft) {"), form.indexOf("createAdminHallDraft({"));
    expect(retry).toContain("return;");
  });

  it("saves the listing first, then its photos, and says so when a photo fails", () => {
    expect(form.indexOf("createAdminHallDraft({")).toBeLessThan(form.indexOf("await finishPhotos(draft, photos)"));
    expect(form).toContain("The listing was saved. Some photos were not.");
  });

  it("still saves without photos, exactly as before", () => {
    expect(form).toContain("if (photos.length > 0) {");
    expect(form).toContain("is waiting for ${f.ownerName} to claim it.");
  });
});

describe("the uploader", () => {
  const field = read("app/admin/hall-drafts/_components/HallPhotosField.tsx");
  const prep = read("lib/prepare-hall-photo.ts");

  it("offers click, drag-and-drop, multiple files and the three formats", () => {
    expect(field).toContain('accept={ACCEPT}');
    expect(field).toContain('const ACCEPT = "image/jpeg,image/png,image/webp"');
    expect(field).toContain("multiple");
    expect(field).toContain("dataTransfer.files");
    expect(field).toContain("No photos added yet");
    expect(field).toContain("Add Photos");
  });

  it("reorders by drag and by buttons that work on touch and keyboard", () => {
    expect(field).toContain("draggable=");
    expect(field).toContain("Move photo ${i + 1} earlier");
    expect(field).toContain("move(i, 0)");
  });

  it("refuses duplicates and anything past the limit, with a reason", () => {
    expect(field).toContain("already added");
    expect(field).toContain("MAX_DRAFT_PHOTOS");
  });

  it("checks bytes before trusting a pick, and keeps a fitting photo untouched", () => {
    expect(prep).toContain("sniffPhotoBytes(head)");
    expect(prep).toContain("return { blob: file, type, width, height, resized: false }");
  });
});

describe("after the owner claims", () => {
  it("the owner's photo delete removes the file, now that the claim records storage_path", () => {
    const owner = read("app/owner/(dashboard)/actions.ts");
    expect(owner).toContain('.remove([image.storage_path])');
    const sql = read("supabase/migrations/0094_admin_hall_draft_photos.sql");
    expect(sql).toContain("insert into public.hall_images (hall_id, url, storage_path, is_cover, sort_order)");
    expect(sql).toContain("hall_images_storage_delete_claimed_draft");
  });

  it("the existing hall cards still pick the cover the claim marks", () => {
    expect(read("lib/halls.ts")).toContain("imgs.find((i) => i.is_cover)?.url");
  });
});
