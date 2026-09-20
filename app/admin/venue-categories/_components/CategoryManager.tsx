"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The admin's venue-category screen.
//
// WHAT IT DELIBERATELY DOES NOT OFFER:
//
//   * DELETE. Halls, enquiries and bookings store the slug, and indexed
//     /venues/<slug> pages are built from it. Removing a row would fail every
//     hall that declared it the next time its owner saved the form. The button
//     says Deactivate, the database has no DELETE grant, and the two agree.
//   * EDITING THE SLUG. Same reason: it is the value already written into
//     other people's data and into URLs Google has. The name is what gets
//     corrected, and it is free to change at any time because nothing keys on
//     it.
//
// The usage count is the number of APPROVED halls declaring the category, and
// it is shown next to Deactivate on purpose — retiring one that 12 venues use
// is a decision that deserves the number in front of it.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus } from "lucide-react";

import {
  createVenueCategory,
  reorderVenueCategories,
  setVenueCategoryActive,
  updateVenueCategory,
} from "@/app/admin/actions";
import {
  VENUE_CATEGORY_GROUPS,
  VENUE_CATEGORY_GROUP_LABELS,
  type VenueCategoryGroup,
} from "@/lib/venue-categories";
import type { AdminVenueCategory } from "@/lib/venue-categories.server";
import { CATEGORY_ICON_NAMES, CategoryIcon } from "@/components/venues/CategoryIcon";
import { Button } from "@/components/ui/Button";
import { slugify } from "@/lib/utils";

type Row = AdminVenueCategory;

const BLANK = {
  slug: "", name: "", pluralNoun: "", description: "",
  icon: "CalendarDays", group: "celebrations" as VenueCategoryGroup, displayOrder: "1000",
};

export function CategoryManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ...BLANK });
  // The slug follows the name until the admin edits it — and then stops, so a
  // deliberate slug is never overwritten by a later typo fix in the name.
  const [slugTouched, setSlugTouched] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ ...BLANK });

  function run(fn: () => Promise<{ success: true } | { error: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) { setError(res.error); return; }
      done?.();
      router.refresh();
    });
  }

  function beginEdit(c: Row) {
    setError(null);
    setEditingId(c.id);
    setEdit({
      slug: c.slug,
      name: c.name,
      pluralNoun: c.pluralNoun,
      description: c.description ?? "",
      icon: c.icon ?? "CalendarDays",
      group: c.group,
      displayOrder: String(c.displayOrder),
    });
  }

  /** Move one category up or down within its own group. */
  function move(group: VenueCategoryGroup, id: string, delta: -1 | 1) {
    const inGroup = rows.filter((r) => r.group === group);
    const i = inGroup.findIndex((r) => r.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= inGroup.length) return;
    const next = [...inGroup];
    [next[i], next[j]] = [next[j], next[i]];
    run(() => reorderVenueCategories({ ids: next.map((r) => r.id) }));
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* ── Add ──────────────────────────────────────────────────────── */}
      {adding ? (
        <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
          <h2 className="font-serif text-base font-semibold text-charcoal-900">New category</h2>
          <Fields
            value={draft}
            onChange={(patch) => {
              setDraft((d) => {
                const next = { ...d, ...patch };
                if ("slug" in patch) setSlugTouched(true);
                if ("name" in patch && !slugTouched) next.slug = slugify(patch.name ?? "");
                return next;
              });
            }}
            showSlug
          />
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal-500">
            The slug is permanent. It is stored on every hall that picks this category and it appears in
            the address of that category&apos;s page, so it cannot be changed later — only the name can.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => createVenueCategory({ ...draft, displayOrder: draft.displayOrder }),
                  () => { setAdding(false); setDraft({ ...BLANK }); setSlugTouched(false); },
                )
              }
            >
              <Check className="mr-1.5 h-4 w-4" /> Create
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => { setAdding(true); setError(null); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add a category
        </Button>
      )}

      {/* ── The catalogue, by group ──────────────────────────────────── */}
      {VENUE_CATEGORY_GROUPS.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              {VENUE_CATEGORY_GROUP_LABELS[group]}
            </h2>
            <ul className="mt-2 space-y-2">
              {inGroup.map((c, i) => (
                <li
                  key={c.id}
                  className={`rounded-2xl border bg-white p-3 shadow-card ${
                    c.isActive ? "border-border" : "border-dashed border-charcoal-300 bg-charcoal-50"
                  }`}
                >
                  {editingId === c.id ? (
                    <>
                      <Fields value={edit} onChange={(patch) => setEdit((d) => ({ ...d, ...patch }))} />
                      <div className="mt-3 flex gap-2">
                        <Button
                          disabled={pending}
                          onClick={() =>
                            run(() => updateVenueCategory({ ...edit, id: c.id }), () => setEditingId(null))
                          }
                        >
                          <Check className="mr-1.5 h-4 w-4" /> Save
                        </Button>
                        <Button variant="secondary" disabled={pending} onClick={() => { setEditingId(null); setError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-maroon-600">
                        <CategoryIcon name={c.icon} className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-semibold text-charcoal-900">
                          {c.name}
                          {!c.isActive && (
                            <span className="rounded-full bg-charcoal-200 px-2 py-0.5 text-[10px] font-bold uppercase text-charcoal-700">
                              Not offered
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-charcoal-500">
                          <code>{c.slug}</code> · {c.pluralNoun} · order {c.displayOrder} ·{" "}
                          {/* The number that should decide whether this gets retired. */}
                          {c.hallCount} live {c.hallCount === 1 ? "hall" : "halls"}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <IconBtn label="Move up"   disabled={pending || i === 0}                onClick={() => move(group, c.id, -1)}><ArrowUp className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move down" disabled={pending || i === inGroup.length - 1} onClick={() => move(group, c.id, 1)}><ArrowDown className="h-4 w-4" /></IconBtn>
                        <IconBtn label={`Edit ${c.name}`} disabled={pending} onClick={() => beginEdit(c)}><Pencil className="h-4 w-4" /></IconBtn>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => setVenueCategoryActive({ id: c.id, isActive: !c.isActive }))}
                          className={`min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                            c.isActive
                              ? "border border-border bg-white text-charcoal-700 hover:border-red-300 hover:text-red-700"
                              : "bg-maroon-600 text-white hover:bg-maroon-700"
                          }`}
                        >
                          {c.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-[11px] leading-relaxed text-charcoal-500">
        Deactivating a category stops it being offered: it disappears from the owner&apos;s form, the search
        chips and the discovery grid, and no venue can newly pick it. Venues that already declared it keep
        it and stay editable — which is why there is no delete.
      </p>
    </div>
  );
}

function IconBtn({
  label, onClick, disabled, children,
}: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-charcoal-600 transition-colors hover:border-maroon-300 hover:text-maroon-700 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

type FieldValues = typeof BLANK;

/** The create and edit forms are the same fields; only the slug differs. */
function Fields({
  value, onChange, showSlug = false,
}: {
  value: FieldValues;
  onChange: (patch: Partial<FieldValues>) => void;
  showSlug?: boolean;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Name">
        <input
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Birthday Party"
          className={INPUT}
        />
      </Field>

      <Field label="Plural, lower case" hint="Used in “… hosts birthday parties in Madurai.”">
        <input
          value={value.pluralNoun}
          onChange={(e) => onChange({ pluralNoun: e.target.value })}
          placeholder="birthday parties"
          className={INPUT}
        />
      </Field>

      {showSlug && (
        <Field label="Slug" hint="Permanent. Appears in /venues/…">
          <input
            value={value.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            placeholder="birthday-party"
            className={INPUT}
          />
        </Field>
      )}

      <Field label="Group">
        <select
          value={value.group}
          onChange={(e) => onChange({ group: e.target.value as VenueCategoryGroup })}
          className={INPUT}
        >
          {VENUE_CATEGORY_GROUPS.map((g) => (
            <option key={g} value={g}>{VENUE_CATEGORY_GROUP_LABELS[g]}</option>
          ))}
        </select>
      </Field>

      <Field label="Icon">
        {/* A LIST, NOT A TEXT BOX. The name is resolved through a fixed map at
            render time, so anything outside it silently becomes the fallback —
            a free-text field would let an admin type "Cake " and quietly get a
            calendar. */}
        <select
          value={value.icon}
          onChange={(e) => onChange({ icon: e.target.value })}
          className={INPUT}
        >
          {CATEGORY_ICON_NAMES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </Field>

      <Field label="Order" hint="Lower sorts first, within the group.">
        <input
          type="number"
          inputMode="numeric"
          value={value.displayOrder}
          onChange={(e) => onChange({ displayOrder: e.target.value })}
          className={INPUT}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Description" hint="Shown as a tooltip on the owner’s picker. Optional.">
          <input
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Party halls for birthdays, from first birthdays to milestones."
            className={INPUT}
          />
        </Field>
      </div>
    </div>
  );
}

const INPUT =
  "min-h-[44px] w-full rounded-xl border border-border bg-white px-3 text-sm text-charcoal-800 " +
  "placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-2 focus:ring-maroon-100";

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-charcoal-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-charcoal-500">{hint}</span>}
    </label>
  );
}
