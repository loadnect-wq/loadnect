import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { AppHeader } from "@/components/app/AppHeader";
import { SavedView } from "./_components/SavedView";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Saved Halls");

export default function SavedPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Saved" />
      <SavedView />
    </div>
  );
}
