"use client";

import { useState } from "react";
import { Mail, MapPin, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { APP_NAME, CONTACT } from "@/lib/constants";

const CONTACT_ITEMS = [
  { Icon: Mail,    label: "Email",   value: CONTACT.email },
  { Icon: Phone,   label: "Phone",   value: CONTACT.phones.join(", ") },
  { Icon: MapPin,  label: "Address", value: CONTACT.address },
] as const;

export default function ContactPage() {
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    toast({
      title: "Message sent!",
      description: "We'll get back to you within 24 hours.",
      variant: "success",
    });
    setName(""); setEmail(""); setSubject(""); setMessage("");
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-ivory-100">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="bg-maroon-950 py-16 text-center">
        <div className="container-page">
          <p className="ornament-row mb-4 text-sm text-gold-400">✦</p>
          <h1 className="font-serif text-4xl font-bold text-ivory-100 sm:text-5xl">
            Get in Touch
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base text-ivory-400">
            Whether you&apos;re a couple planning a wedding or an owner with a question — we&apos;re here to help.
          </p>
        </div>
      </section>

      {/* ── Contact grid ─────────────────────────────────────── */}
      <section className="container-page py-16">
        <div className="grid gap-10 lg:grid-cols-3">

          {/* Info */}
          <div className="space-y-8">
            <div>
              <h2 className="font-serif text-2xl font-semibold text-charcoal-900">Contact Info</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Our support team is available Monday–Saturday, 9 AM – 7 PM IST.
              </p>
            </div>
            <ul className="space-y-5">
              {CONTACT_ITEMS.map(({ Icon, label, value }) => (
                <li key={label} className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-maroon-50 text-maroon-600">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-sm text-charcoal-800">{value}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-border bg-white p-5 shadow-card">
              <p className="font-serif text-sm font-semibold text-charcoal-900">{APP_NAME} Support</p>
              <p className="mt-1 text-xs text-muted-foreground">
                We typically respond to all inquiries within 24 hours on business days.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-8 shadow-card">
              <h2 className="font-serif text-2xl font-semibold text-charcoal-900">Send a Message</h2>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" placeholder="Priya Sharma" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email address</Label>
                    <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" placeholder="How can we help?" value={subject} onChange={(e) => setSubject(e.target.value)} required />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message">Message</Label>
                  <textarea
                    id="message"
                    rows={5}
                    placeholder="Tell us more about your inquiry…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 resize-none"
                  />
                </div>

                <Button type="submit" variant="gold" size="lg" isLoading={loading} className="gap-2">
                  <Send className="h-4 w-4" aria-hidden />
                  {loading ? "Sending…" : "Send Message"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
