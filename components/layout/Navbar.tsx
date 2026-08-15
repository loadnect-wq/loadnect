"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X, LogOut, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/Button";
import { APP_NAME, NAV_LINKS, getDashboardPath } from "@/lib/constants";
import { getSupabaseClient } from "@/lib/supabase/client";

type NavUser = { fullName: string | null; role: string } | null;

export function Navbar() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<NavUser>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await supabase
        .from("profiles" as any)
        .select("full_name, role")
        .eq("id", authUser.id)
        .single();

      if (data) {
        const d = data as { full_name: string | null; role: string };
        setUser({ fullName: d.full_name, role: d.role });
      }
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

  const dashboardPath = user ? getDashboardPath(user.role) : "/";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-border bg-white/95 shadow-sm backdrop-blur-md"
          : "border-b border-transparent bg-ivory-100/80 backdrop-blur-sm",
      )}
    >
      <div className="container-page">
        <nav className="flex h-16 items-center justify-between" aria-label="Main navigation">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
            <span className="relative block h-9 w-9 shrink-0 transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <Image src="/logo.png" alt="" fill sizes="36px" className="object-contain" priority />
            </span>
            <span className="font-serif text-xl font-bold tracking-tight text-maroon-800 transition-colors group-hover:text-maroon-600">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav links */}
          <ul className="hidden items-center gap-7 lg:flex" role="list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "relative text-sm font-medium text-charcoal-600",
                    "transition-colors duration-150 hover:text-maroon-700",
                    "after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0",
                    "after:bg-maroon-500 after:transition-[width] after:duration-200",
                    "hover:after:w-full",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2 lg:flex">
            {user ? (
              <>
                <Link
                  href={dashboardPath}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <LayoutDashboard className="mr-1.5 h-4 w-4" />
                  Dashboard
                </Link>
                <span className="text-sm font-medium text-charcoal-600">
                  {user.fullName ?? "Account"}
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
                <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Sign In
                </Link>
                <Link href="/owner/register" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  List Your Hall
                </Link>
                <Link href="/signup" className={buttonVariants({ variant: "gold", size: "sm" })}>
                  Get Started
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
              {user ? (
                <>
                  <p className="px-3 text-sm font-medium text-charcoal-700">
                    {user.fullName ?? "My Account"}
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
                    className={buttonVariants({ variant: "outline", size: "sm", className: "w-full justify-center" })}
                    onClick={() => setMobileOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/signup"
                    className={buttonVariants({ variant: "gold", size: "sm", className: "w-full justify-center" })}
                    onClick={() => setMobileOpen(false)}
                  >
                    Get Started
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
