// /guides — the planning guides index. Everything is in
// components/guides/GuidesIndex.tsx; the list is lib/guides.ts.

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { GuidesIndex } from "@/components/guides/GuidesIndex";
import { guidesIndexMetadata } from "@/lib/seo/guide-metadata";

export const metadata: Metadata = guidesIndexMetadata("en");

export default function GuidesPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Guides" />
      <GuidesIndex lang="en" />
    </div>
  );
}
