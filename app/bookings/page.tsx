import { redirect } from "next/navigation";

// /bookings was a mock page whose booking list was a hardcoded empty array, so
// it told every customer they had no bookings — including one who had just
// paid. It is the primary "Bookings" tab in the mobile nav, so that was the
// first place a paying customer looked.
//
// Kept as a redirect rather than deleted: the path is in the bottom nav's
// history, in browser bookmarks, and in any link already shared.
export default function BookingsRedirect() {
  redirect("/customer/bookings");
}
