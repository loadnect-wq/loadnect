import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { SavedView } from "./_components/SavedView";

export const metadata: Metadata = { title: "Saved Halls" };

export default function SavedPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Saved" />
      <SavedView />
    </div>
  );
}
