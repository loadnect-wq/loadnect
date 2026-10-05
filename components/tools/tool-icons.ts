// One icon per family tool, shared by the server-rendered cards
// (FamilyTools.tsx) and the client Profile tab, so a tool looks the same
// everywhere it is offered. The tools themselves are lib/family-tools.ts.

import { Calculator, CalendarHeart, ClipboardList, Heart, type LucideIcon } from "lucide-react";
import type { FamilyToolKey } from "@/lib/family-tools";

export const TOOL_ICONS: Record<FamilyToolKey, LucideIcon> = {
  muhurtham: CalendarHeart,
  budget: Calculator,
  shortlist: Heart,
  planner: ClipboardList,
};
