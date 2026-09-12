import { redirect } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// There is no separate sign-up any more.
//
// Both remaining doors create an account on first use: Google mints one on the
// first sign-in, and a mobile number gets one the moment MSG91 approves the
// code. A page offering to "create an account" would be offering a third thing
// that does not exist, and the email-and-password form it used to hold is gone
// for the reasons written at the top of ../login/page.tsx.
//
// Kept as a redirect rather than deleted because /signup is linked from the
// navbar, the profile screen and the owner registration page, and is the kind
// of URL people bookmark and paste. Removing the route would turn every one of
// those into a 404 to save one file.
//
// The query string is deliberately not forwarded: the only parameter /login
// honours is ?next=, its allow-list is the control that stops that parameter
// naming a privileged path, and passing anything through here would be a second
// place to get that wrong.
// ─────────────────────────────────────────────────────────────────────────────

export default function SignupPage() {
  redirect("/login");
}
