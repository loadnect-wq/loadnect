// ─────────────────────────────────────────────────────────────────────────────
// components/venues/CategoryIcon.tsx — the icon for one venue category.
//
// venue_categories.icon holds a lucide-react EXPORT NAME ("Cake", "Briefcase"),
// typed by an admin. This resolves it through a fixed map.
//
// A MAP, NOT A DYNAMIC LOOKUP, and not `(icons as any)[name]`. Three reasons,
// in order of how much they would hurt:
//
//   1. The field is admin-editable and ends up rendered. Anything that turns a
//      stored string into a component — or worse, into markup — is a hole with
//      a form attached to it. This can only ever produce one of the components
//      listed below.
//   2. Indexing the whole lucide barrel defeats tree-shaking: every icon in
//      the library lands in the bundle of every page that shows a chip.
//   3. A typo or a since-renamed icon resolves to `undefined` and React
//      crashes the page. Here it falls back, silently and correctly.
//
// The consequence is real and worth stating: an admin who types an icon name
// that is not on this list gets the fallback, not their icon. Adding one is a
// one-line change here. That is the deliberate trade — a deploy to add a NEW
// PICTURE, no deploy to add a category.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Baby, BookOpen, Briefcase, Building2, Cake, CalendarDays, Camera,
  ClipboardList, Drama, Gem, GraduationCap, Heart, HeartHandshake, Landmark,
  Lock, Network, PartyPopper, Presentation, Rocket, School, Sparkles, Store,
  Users, UsersRound, Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Baby, BookOpen, Briefcase, Building2, Cake, CalendarDays, Camera,
  ClipboardList, Drama, Gem, GraduationCap, Heart, HeartHandshake, Landmark,
  Lock, Network, PartyPopper, Presentation, Rocket, School, Sparkles, Store,
  Users, UsersRound, Wrench,
};

/** The icon names an admin may choose from, for the management form's picker. */
export const CATEGORY_ICON_NAMES = Object.keys(ICONS).sort();

/** Used when the stored name is empty, misspelled, or no longer in the map. */
const FALLBACK: LucideIcon = CalendarDays;

export function CategoryIcon({
  name,
  className = "h-5 w-5",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || FALLBACK;
  // Decorative in every place it is used: each one is accompanied by the
  // category's name in text, so announcing the picture would repeat it.
  return <Icon className={className} aria-hidden />;
}
