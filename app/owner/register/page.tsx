"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Gem, Lock, Mail, User } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/app-url";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { ownerRegisterSchema } from "@/lib/validation/schemas";

export default function OwnerRegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();

    const parsed = ownerRegisterSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      toast({ title: "Check your details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }

    setLoading(true);

    const { data, error } = await getSupabaseClient().auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { name: parsed.data.name, role: "owner" },
        emailRedirectTo: buildAuthCallbackUrl("/auth/redirect"),
      },
    });

    if (error) {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
    } else if (data.session) {
      toast({ title: "Registration submitted!", variant: "success" });
      router.push("/owner/dashboard");
      router.refresh();
    } else {
      setDone(true);
    }

    setLoading(false);
  }

  function handleGoogleSignUp() {
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl("/auth/set-owner-role") },
    });
  }

  if (done) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-ivory-100 px-4 py-12">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-maroon-100">
            <CheckCircle2 className="h-8 w-8 text-maroon-600" />
          </div>
          <h2 className="font-serif text-2xl font-bold text-charcoal-900">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <strong className="text-charcoal-800">{email}</strong>.
            Click it to activate your account. Your owner account is ready — add your hall to begin verification.
          </p>
          <Link href="/login" className="inline-block text-sm font-semibold text-maroon-600 hover:underline">
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-ivory-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-maroon-600 text-ivory-100">
              <Gem className="h-5 w-5" />
            </span>
            <span className="font-serif text-2xl font-bold text-maroon-800">Hallnect</span>
          </Link>
          <h1 className="mt-6 font-serif text-3xl font-bold text-charcoal-900">List Your Hall</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Register as a venue owner and start receiving bookings</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-card space-y-5">
          <div className="rounded-xl border-2 border-maroon-200 bg-maroon-50 p-4">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" />
              <div className="text-sm text-charcoal-700">
                <p className="font-medium text-maroon-800">Owner Account</p>
                <p className="mt-1 text-muted-foreground">
                  Your owner account is ready as soon as you register. Each hall you add is reviewed by our team before it goes live.
                  Once approved, you can list halls and manage bookings.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignUp}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-charcoal-700 transition-colors hover:bg-ivory-50 hover:border-maroon-300"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="relative flex items-center">
            <div className="flex-1 border-t border-border" />
            <span className="mx-3 shrink-0 text-xs text-muted-foreground">or register with email</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="name" type="text" placeholder="Your full name" className="pl-9" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="email" type="email" placeholder="you@example.com" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="password" type="password" placeholder="Min. 8 characters" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" minLength={8} />
              </div>
            </div>

            <Button type="submit" variant="gold" className="w-full" isLoading={loading}>
              {loading ? "Registering…" : "Register as Owner"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              By registering you agree to our{" "}
              <Link href="/legal/terms" className="underline hover:text-foreground">Terms</Link>
              {" "}and{" "}
              <Link href="/legal/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
            </p>
          </form>
        </div>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-maroon-600 hover:underline">Sign in</Link>
          </p>
          <p>
            Just looking for a venue?{" "}
            <Link href="/signup" className="font-semibold text-maroon-600 hover:underline">Sign up as customer</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
