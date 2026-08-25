import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { AppHeader } from "@/components/app/AppHeader";
import { ProfileView } from "./_components/ProfileView";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Profile");

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Profile" />
      <ProfileView />
    </div>
  );
}
