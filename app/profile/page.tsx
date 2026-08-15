import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { ProfileView } from "./_components/ProfileView";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Profile" />
      <ProfileView />
    </div>
  );
}
