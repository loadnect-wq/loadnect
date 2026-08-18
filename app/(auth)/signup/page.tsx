"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Mail, User } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl, rememberAuthNext } from "@/lib/app-url";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { signupSchema } from "@/lib/validation/schemas";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();

    const parsed = signupSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      toast({ title: "Check your details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }

    setLoading(true);

    const { data, error } = await getSupabaseClient().auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { name: parsed.data.name, role: "customer" },
        emailRedirectTo: buildAuthCallbackUrl(),
      },
    });

    if (error) {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
    } else if (data.session) {
      toast({ title: "Welcome to Hallnect!", variant: "success" });
      router.push("/auth/redirect");
      router.refresh();
    } else {
      setDone(true);
    }

    setLoading(false);
  }

  function handleGoogleSignUp() {
    rememberAuthNext("/auth/redirect");
    getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl() },
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
            Click it to activate your account.
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
          <Link href="/" className="inline-flex flex-col items-center gap-2.5" aria-label="Hallnect home">
            <span className="relative block h-16 w-16">
              <Image src="/logo.png" alt="Hallnect" fill sizes="64px" className="object-contain" priority />
            </span>
            <span className="font-serif text-2xl font-bold text-maroon-800">Hallnect</span>
          </Link>
          <h1 className="mt-6 font-serif text-3xl font-bold text-charcoal-900">Create an account</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Find and book your perfect venue in Tamil Nadu</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-card space-y-5">
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
            <span className="mx-3 shrink-0 text-xs text-muted-foreground">or sign up with email</span>
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
              {loading ? "Creating account…" : "Create Account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              By registering you agree to our{" "}
              <Link href="/terms" className="underline hover:text-foreground">Terms</Link>
              {" "}and{" "}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
            </p>
          </form>
        </div>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-maroon-600 hover:underline">Sign in</Link>
          </p>
          <p>
            Want to list your hall?{" "}
            <Link href="/owner/register" className="font-semibold text-maroon-600 hover:underline">Register as owner</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
