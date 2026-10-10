"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Heart, Menu, X, LogOut, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/Button";
import { APP_NAME, NAV_LINKS, getDashboardPath } from "@/lib/constants";
import { FAMILY_TOOLS } from "@/lib/family-tools";
import { TOOL_ICONS } from "@/components/tools/tool-icons";
import { useSavedHalls } from "@/lib/hooks/useSavedHalls";

type NavUser = { fullName: string | null; role: string } | null;

/**
 * The Supabase client, fetched on demand rather than bundled into the page.
 *
 * SEO phase 6 (2026-10-10): a static import put the whole client — 222 KB of
 * script, 57 KB compressed — into the start-up bundle of EVERY page, because
 * this header is on every page. All the header does with it is ask, after the
 * page is up, who is signed in. A dynamic import makes the client its own file
 * that loads after hydration, so a visitor's first paint and first tap no
 * longer wait behind it. Nothing here needs it sooner: until it answers, the
 * cookie hint below already rules the signed-out case in or out.
 */
const loadSupabase = () => import("@/lib/supabase/client").then((m) => m.getSupabaseClient());

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
    // The import resolves after this effect returns, so an unmount in between
    // must stop it subscribing at all.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    loadSupabase().then((supabase) => {
      if (cancelled) return;

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
      unsubscribe = () => subscription.unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = await loadSupabase();
    await supabase.auth.signOut();
    setUser(null);
    setMobileOpen(false);
    router.push("/login");
    router.refresh();
    setSigningOut(false);
  }

  const dashboardPath = authView ? getDashboardPath(authView.role) : "/";

  // Only the homepage has a video behind the header. Everywhere else the bar
  // keeps its normal surface. Styling lives in globals.css so that crossing the
  // scroll threshold stays a pure CSS class toggle and never re-renders this
  // component — the same reason `hallnect-header` works the way it does.
  const overHero = pathname === "/";

  // INSIDE A DASHBOARD THE FAMILY LINKS ARE NOISE. The admin and owner areas
  // have their own navigation; above it this header offered Muhurtham Dates,
  // the budget calculator and a Saved list to someone running a hall or the
  // platform. There it keeps the logo and the account controls only. The
  // public owner landing page (/owner/register) is not a dashboard.
  const workspace =
    pathname.startsWith("/admin") ||
    (pathname.startsWith("/owner") && !pathname.startsWith("/owner/register"));

  return (
    // `hallnect-header` is styled in app/globals.css against `html.is-scrolled`,
    // which the one shared scroll listener in RevealObserver already maintains.
    // Pure CSS, so crossing the threshold no longer re-renders this component —
    // and `hidden lg:block` moved here off the deleted wrapper (see layout.tsx).
    <header
      className={cn(
        "hallnect-header hidden lg:block sticky top-0 z-50 w-full border-b",
        overHero && "hallnect-header--over-hero",
      )}
    >
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
            <span className="hallnect-nav-ink font-serif text-xl font-bold tracking-tight text-maroon-800 transition-colors group-hover:text-maroon-600">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav links */}
          {!workspace && (
          <ul className="hidden items-center gap-6 lg:flex" role="list">
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
              if (link.menu) {
                return <PlanMenu key={href} label={link.label} href={href} pathname={pathname} />;
              }
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={link.href} className={link.wide ? "hidden xl:block" : undefined}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative whitespace-nowrap text-sm font-medium",
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
          )}

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2 lg:flex">
            {/* THE SAVED LIST, REACHABLE ON A COMPUTER. Saving a hall works on
                every screen, but the list itself was only a tab in the phone's
                bottom bar — on a desktop a family could heart a hall and never
                find it again. Everyone gets it: the list lives in the browser,
                signed in or not. */}
            {!workspace && <SavedLink active={pathname.startsWith("/saved")} />}
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
                {/* Truncated: the header is measured for it (see NAV_LINKS). A
                    long name would otherwise push the links onto two lines. */}
                <span
                  title={authView.fullName ?? undefined}
                  className="hallnect-nav-ink max-w-[6rem] truncate text-sm font-medium text-charcoal-600"
                >
                  {authView.fullName ?? "Account"}
                </span>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "hallnect-nav-outline" })}
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
                <Link
                  href="/owner/register"
                  className={buttonVariants({ variant: "outline", size: "sm", className: "hallnect-nav-outline" })}
                >
                  List Your Hall
                </Link>
                {/* hallnect-nav-solid: keeps its own maroon-900 ink over the
                    hero video. See the note in globals.css — whitening this
                    one takes it from 4.93:1 to 2.14:1. */}
                <Link
                  href="/login"
                  className={buttonVariants({ variant: "gold", size: "sm", className: "hallnect-nav-solid" })}
                >
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

/**
 * "Plan Your Function" and the tools under it (lib/family-tools.ts).
 *
 * Muhurtham Dates and Budget Calculator used to be header links of their own,
 * beside this one, though both are on the page it opens — so they moved in
 * here, where each is still one click from any page. The label opens the
 * menu; the page itself is the menu's last link.
 *
 * HOW IT OPENS AND CLOSES:
 *   • A mouse resting on it opens it, and leaving closes it — unless it was
 *     clicked, which pins it open until a click outside.
 *   • Keyboard: Enter/Space on the button; Escape closes and returns focus to
 *     the button; tabbing out of it closes it.
 *   • Any page change closes it. "Open" is stored as the path it was opened
 *     on, so a new path is closed by definition — no effect has to notice.
 *
 * NOT CLOSED ON BLUR. Safari does not focus a link when it is clicked, so a
 * blur-to-close unmounted the menu between mousedown and click and the click
 * was lost. Focus moving to something OUTSIDE (focusin) is what closes it.
 *
 * Its links carry hallnect-nav-solid: over the homepage video every header
 * link is whitened (globals.css), and these sit on the menu's own white panel.
 */
function PlanMenu({ label, href, pathname }: { label: string; href: string; pathname: string }) {
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const rootRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const byHover = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);

  const active = pathname.startsWith(href) || FAMILY_TOOLS.some((t) => pathname.startsWith(t.href));

  const close = () => {
    byHover.current = false;
    setOpenAt(null);
  };

  useEffect(() => {
    if (!open) return;
    const shut = () => {
      byHover.current = false;
      setOpenAt(null);
    };
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && rootRef.current?.contains(target));
    const onPointerDown = (e: PointerEvent) => { if (outside(e.target)) shut(); };
    const onFocusIn = (e: FocusEvent) => { if (outside(e.target)) shut(); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        shut();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <li
      ref={rootRef}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        window.clearTimeout(closeTimer.current);
        if (!open) {
          byHover.current = true;
          setOpenAt(pathname);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || !byHover.current) return;
        // A short grace, so a pointer crossing the gap to the panel, or
        // overshooting its edge, does not snap it shut.
        closeTimer.current = window.setTimeout(close, 180);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="plan-menu"
        onClick={() => {
          // Hover already opened it: the click pins it rather than shutting
          // the menu the pointer is resting on.
          if (open && byHover.current) {
            byHover.current = false;
            return;
          }
          byHover.current = false;
          setOpenAt(open ? null : pathname);
        }}
        className={cn(
          "hallnect-nav-ink inline-flex items-center gap-1",
          "relative whitespace-nowrap text-sm font-medium",
          "transition-colors duration-150 hover:text-maroon-700",
          "after:absolute after:-bottom-0.5 after:left-0 after:h-px",
          "after:bg-maroon-500 after:transition-[width] after:duration-200",
          "hover:after:w-full",
          active || open ? "text-maroon-700 after:w-full" : "text-charcoal-600 after:w-0",
        )}
      >
        {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        // pt-3, not mt-3: the gap belongs to this element, so a pointer
        // crossing from the button to the panel never leaves the menu.
        <div id="plan-menu" className="absolute left-1/2 top-full z-50 w-[21rem] -translate-x-1/2 pt-3">
          <div className="rounded-2xl border border-border bg-white p-2 shadow-xl">
            <ul role="list">
              {FAMILY_TOOLS.map((tool) => {
                const Icon = TOOL_ICONS[tool.key];
                const here = pathname.startsWith(tool.href);
                return (
                  <li key={tool.key}>
                    <Link
                      href={tool.href}
                      onClick={close}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "hallnect-nav-solid flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-maroon-50",
                        here && "bg-maroon-50",
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-maroon-50 text-maroon-700">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-charcoal-900">{tool.title}</span>
                        <span className="block text-xs text-charcoal-500">{tool.step}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              href={href}
              onClick={close}
              className="hallnect-nav-solid mt-1 block rounded-xl border-t border-border px-3 py-2.5 text-xs font-semibold text-maroon-700 transition-colors hover:bg-maroon-50"
            >
              All planning tools →
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

/** "Saved" with how many halls are on the list. The count is this browser's own list. */
function SavedLink({ active }: { active: boolean }) {
  const { ids } = useSavedHalls();
  const n = ids.length;
  return (
    <Link
      href="/saved"
      aria-current={active ? "page" : undefined}
      aria-label={n > 0 ? `Saved halls (${n})` : "Saved halls"}
      className={cn(
        "hallnect-nav-ink relative mr-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors hover:text-maroon-700",
        active ? "text-maroon-700" : "text-charcoal-600",
      )}
    >
      {/* Filled in the link's own ink, so it turns white with the rest of the
          header over the homepage video instead of sinking into it. */}
      <Heart className={cn("h-4 w-4", n > 0 && "fill-current")} aria-hidden />
      {/* The word from 1280px: at 1024 a signed-in header with a long name
          measured 11px too wide with it. The heart and the count still say
          it, and the link's aria-label names it. */}
      <span className="hidden xl:inline">Saved</span>
      {n > 0 && (
        <span className="ml-0.5 min-w-[1.25rem] rounded-full bg-maroon-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white" aria-hidden>
          {n}
        </span>
      )}
    </Link>
  );
}
