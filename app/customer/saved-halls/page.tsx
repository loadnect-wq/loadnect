import { redirect } from "next/navigation";

// THE ACCOUNT'S SAVED LIST WAS NEVER WRITTEN TO. The heart on every hall saves
// to this browser's list (lib/hooks/useSavedHalls), shown at /saved — nothing
// inserts into the saved_halls table this page read, so it said "No saved
// halls yet" to every family whatever they had saved. Old links and bookmarks
// land on the real list.
export default function SavedHallsRedirect() {
  redirect("/saved");
}
