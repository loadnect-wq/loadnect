"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { loginSchema } from "@/lib/validation/schemas";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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
      router.push("/auth/redirect");
      router.refresh();
    }

    setLoading(false);
  }

  function handleGoogleLogin() {
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/auth/redirect` },
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
          <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your account to continue</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-card space-y-5">
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
          <p>
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-semibold text-maroon-600 hover:underline">
              Create account
            </Link>
          </p>
          <p>
            Want to list your hall?{" "}
            <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">
              Register as owner
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
