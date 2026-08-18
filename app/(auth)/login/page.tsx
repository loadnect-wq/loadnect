"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/app-url";
import { IntentSelector, type AuthIntent } from "../_components/IntentSelector";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { loginSchema } from "@/lib/validation/schemas";

// Only root-relative internal paths are honoured; anything else (absolute URL,
// protocol-relative //evil.com, backslash trick) falls back to the role router.
function safeNextPath(raw: string | null): string {
  const fallback = "/auth/redirect";
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  try {
    const u = new URL(raw, "https://internal.invalid");
    if (u.origin !== "https://internal.invalid") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed:     "Google sign-in could not be completed. Please try again.",
  account_disabled: "This account has been deactivated. Contact Hallnect support if you think this is a mistake.",
};

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep links like /book/<slug> send the user here as ?next=…; without this the
  // destination was discarded and they landed on their dashboard instead.
  const nextPath = safeNextPath(searchParams.get("next"));
  const authError = AUTH_ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // UX-only intent. Never sent to the owner-upgrade path and never read for
  // authorization — post-login routing is decided by the DB role alone.
  // sessionStorage (not a cookie/URL) so it survives the Google round-trip
  // without ever becoming something the server could mistake for a claim.
  const [intent, setIntent] = useState<AuthIntent>("book");

  // Read after mount so server and client render identically (no hydration gap).
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("hallnect:auth-intent");
      if (saved === "book" || saved === "list") setIntent(saved);
    } catch { /* storage blocked — default stands */ }
  }, []);

  function chooseIntent(next: AuthIntent) {
    setIntent(next);
    try { window.sessionStorage.setItem("hallnect:auth-intent", next); } catch { /* ignore */ }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast({ title: "Check your details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }

    setLoading(true);

    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
    } else {
      router.push(nextPath);
      router.refresh();
    }

    setLoading(false);
  }

  function handleGoogleLogin() {
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl(nextPath) },
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-ivory-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex flex-col items-center gap-2.5" aria-label="Hallnect home">
            <span className="relative block h-16 w-16">
              <Image src="/logo.png" alt="Hallnect" fill sizes="64px" className="object-contain" priority />
            </span>
            <span className="font-serif text-2xl font-bold text-maroon-800">Hallnect</span>
          </Link>
          <h1 className="mt-6 font-serif text-3xl font-bold text-charcoal-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {intent === "list"
              ? "Sign in to manage your venue and bookings"
              : "Sign in to find and book your perfect venue"}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-card space-y-5">
          <IntentSelector value={intent} onChange={chooseIntent} />

          <div className="h-px bg-border" />

          {authError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {authError}
            </div>
          )}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-charcoal-700 transition-colors hover:bg-ivory-50 hover:border-maroon-300 active:bg-ivory-100"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="relative flex items-center">
            <div className="flex-1 border-t border-border" />
            <span className="mx-3 shrink-0 text-xs text-muted-foreground">or continue with email</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" isLoading={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </div>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          {intent === "list" ? (
            <p>
              New to Hallnect?{" "}
              <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
                Register your venue
              </Link>
            </p>
          ) : (
            <p>
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-maroon-600 hover:underline">
                Create account
              </Link>
            </p>
          )}
          <p className="text-xs">
            {intent === "list"
              ? "Already booking with us? Sign in above — we'll take you to your account."
              : "Own a venue? "}
            {intent === "book" && (
              <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
                List your hall
              </Link>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
