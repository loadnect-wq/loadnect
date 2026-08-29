import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo/metadata";
import { AppHeader } from "@/components/app/AppHeader";
import { ProfileView } from "./_components/ProfileView";
import { isTwilioConfigured } from "@/lib/twilio/verify";

// SEO: private/transactional page — must never be indexed.
export const metadata: Metadata = noindexMetadata("Profile");

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Profile" />
      {/* Whether phone verification can actually work is a SERVER fact (it needs
          TWILIO_VERIFY_SERVICE_SID). ProfileView is a client component, so it
          is passed down. Offering "Verify your phone" when the service is not
          configured sent people to a page whose only content was "Phone
          verification isn't available yet" — a dead row that reads as broken.
          The moment the env var is set the row comes back on its own. */}
      <ProfileView phoneVerificationAvailable={isTwilioConfigured()} />
    </div>
  );
}
