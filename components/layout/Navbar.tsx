"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/Button";
import { APP_NAME, NAV_LINKS, getDashboardPath } from "@/lib/constants";
import { getSupabaseClient } from "@/lib/supabase/client";

type NavUser = { fullName: string | null; role: string } | null;

/**
 * Is there a Supabase session cookie? Synchronous, no network.
 *
 * @supabase/ssr keeps the session in cookies (not localStorage) so the server
 * and browser share it, which means the browser can read them — they cannot be
 * httpOnly or the client library could not work. That gives us the one fact
 * needed to stop showing the wrong navbar, in the same frame as hydration,
 * instead of after a round trip to a database on another continent.
 *
 * A HINT, NOT AUTHORITY. The cookie may be expired, so this is never used to
 * decide a signed-IN state — only to rule one out. getUser() remains the judge.
 */
/** useSyncExternalStore requires a subscribe fn; the cookie does not change
 *  under us in a way this header needs to react to — onAuthStateChange covers
 *  sign-in and sign-out. */
const NO_SUBSCRIBE = () => () => {};

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((c) => /^\s*sb-.*-auth-token/.test(c));
}

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  // undefined = NOT YET KNOWN, and that is the whole fix. This used to start at
  // null, i.e. "signed out" — an assertion, made before anything had been
  // checked. Every page then painted "Sign In / Get Started" to a signed-in
  // person and corrected itself once the network answered. Now the three states
  // are distinct and the unknown one renders nothing either way.
  const [user, setUser] = useState<NavUser | undefined>(undefined);

  // THE COOKIE HINT, read the way React sanctions a value that legitimately
  // differs between server and client. useSyncExternalStore takes a separate
  // server snapshot, so there is no hydration mismatch and no setState inside
  // an effect: React swaps to the client value as part of hydration rather than
  // in a second render pass afterwards.
  const cookieHint = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => (hasSessionCookie() ? "maybe-signed-in" : "signed-out"),
    () => "unknown",
  );

  // The authoritative answer when we have it; otherwise the only thing the
  // cookie can prove, which is a NEGATIVE. Absence of the cookie means signed
  // out for certain. Presence proves nothing — it may be expired — so that case
  // stays unknown and waits for getUser().
  const authView: NavUser | undefined =
    user !== undefined ? user : cookieHint === "signed-out" ? null : undefined;
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();

    async function loadProfile() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) {
        setUser(null);
        return;
      }

      const { data } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("profiles" as any)
        .select("full_name, role")
        .eq("id", authUser.id)
        .single();

      const d = data as { full_name: string | null; role: string } | null;
      // Set state even when the profile row is missing. Returning early here
      // left `user` at undefined forever, so the header stayed blank for a
      // signed-in user whose profile row had not been created yet.
      setUser({ fullName: d?.full_name ?? null, role: d?.role ?? "customer" });
    }

    loadProfile();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        loadProfile();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await getSupabaseClient().auth.signOut();
    setUser(null);
    setMobileOpen(false);
    router.push("/login");
    router.refresh();
    setSigningOut(false);
  }

  const dashboardPath = authView ? getDashboardPath(authView.role) : "/";

  return (
    // `hallnect-header` is styled in app/globals.css against `html.is-scrolled`,
    // which the one shared scroll listener in RevealObserver already maintains.
    // Pure CSS, so crossing the threshold no longer re-renders this component —
    // and `hidden lg:block` moved here off the deleted wrapper (see layout.tsx).
    <header className="hallnect-header hidden lg:block sticky top-0 z-50 w-full border-b">
      <div className="container-page">
        <nav className="flex h-16 items-center justify-between" aria-label="Main navigation">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
            <span className="relative block h-9 w-9 shrink-0 transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              {/* No `priority`: a 36px mark cannot be an LCP candidate, and
                  preloading it took the early image slot from the venue photo
                  that is. */}
              <Image src="/logo.png" alt="" fill sizes="36px" className="object-contain" />
            </span>
            <span className="font-serif text-xl font-bold tracking-tight text-maroon-800 transition-colors group-hover:text-maroon-600">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav links */}
          <ul className="hidden items-center gap-7 lg:flex" role="list">
            {NAV_LINKS.map((link) => {
              // A prefix match so /halls/ns-khalyaana-mahal still marks
              // "Browse Halls", and an exact match for "/" so the home link
              // would not light up on every page. aria-current carries the
              // same fact to a screen reader, which the underline alone did
              // not — the nav gave no indication of where you were at all.
              // Widened off the `as const` tuple on purpose: no nav link is "/"
              // today, and narrowing would make the home case a type error
              // rather than dead-but-correct code if one is ever added.
              const href: string = link.href;
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative text-sm font-medium",
                      "transition-colors duration-150 hover:text-maroon-700",
                      "after:absolute after:-bottom-0.5 after:left-0 after:h-px",
                      "after:bg-maroon-500 after:transition-[width] after:duration-200",
                      "hover:after:w-full",
                      active
                        ? "text-maroon-700 after:w-full"
                        : "text-charcoal-600 after:w-0",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2 lg:flex">
            {/* THE CACHED HTML MUST ASSERT NOTHING. Every public page is now
                prerendered and served to everyone identically, so the markup
                cannot claim either state. While `user` is undefined this
                reserves the space the real controls will occupy — no "Sign In"
                to contradict a moment later, and no layout shift when the
                answer arrives. */}
            {authView === undefined ? (
              <span className="h-9 w-[260px]" aria-hidden />
            ) : authView ? (
              <>
                <Link
                  href={dashboardPath}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <LayoutDashboard className="mr-1.5 h-4 w-4" />
                  Dashboard
                </Link>
                <span className="text-sm font-medium text-charcoal-600">
                  {authView.fullName ?? "Account"}
                </span>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <LogOut className="mr-1.5 h-4 w-4" />
                  {signingOut ? "Signing out…" : "Sign Out"}
                </button>
              </>
            ) : (
              <>
                {/* One CTA, not two. Signing in and signing up are the same
                    action now — both doors on /login create an account on
                    first use — so "Sign In" and "Get Started" pointed at the
                    same screen and made a visitor choose between synonyms. */}
                <Link href="/owner/register" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  List Your Hall
                </Link>
                <Link href="/login" className={buttonVariants({ variant: "gold", size: "sm" })}>
                  Sign In
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-charcoal-600 transition-colors hover:bg-maroon-50 hover:text-maroon-700 lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </nav>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="mobile-menu" className="border-t border-border bg-white lg:hidden">
          <div className="container-page pb-5 pt-3">
            <ul className="flex flex-col" role="list">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-charcoal-700 transition-colors hover:bg-maroon-50 hover:text-maroon-700"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {authView === undefined ? (
                // The menu only opens on a tap, by which point the answer has
                // almost always arrived; a spinner here would flash more than
                // it explained.
                <p className="px-3 text-sm text-charcoal-400">Loading…</p>
              ) : authView ? (
                <>
                  <p className="px-3 text-sm font-medium text-charcoal-700">
                    {authView.fullName ?? "My Account"}
                  </p>
                  <Link
                    href={dashboardPath}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "w-full justify-center" })}
                    onClick={() => setMobileOpen(false)}
                  >
                    <LayoutDashboard className="mr-1.5 h-4 w-4" />
                    Dashboard
                  </Link>
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm", className: "w-full justify-center" }),
                      "text-red-600 hover:text-red-700 hover:bg-red-50",
                    )}
                  >
                    <LogOut className="mr-1.5 h-4 w-4" />
                    {signingOut ? "Signing out…" : "Sign Out"}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className={buttonVariants({ variant: "gold", size: "sm", className: "w-full justify-center" })}
                    onClick={() => setMobileOpen(false)}
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
