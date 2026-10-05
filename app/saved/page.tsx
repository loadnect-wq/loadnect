import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { AppHeader } from "@/components/app/AppHeader";
import { MoreFamilyTools } from "@/components/tools/FamilyTools";
import { SavedView } from "./_components/SavedView";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Saved Halls");

export default function SavedPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Saved" />
      <SavedView />
      {/* The shortlist is one of four planning tools; the others are a tap away. */}
      <div className="container-app pb-16 lg:max-w-7xl">
        <MoreFamilyTools current="shortlist" />
      </div>
    </div>
  );
}
