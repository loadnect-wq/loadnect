"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { updateProfile } from "@/app/customer/actions";

interface Props {
  initialName:  string | null;
  initialPhone: string | null;
  email:        string | null;
  initialSmsEnabled?: boolean;
}

export function ProfileEditForm({ initialName, initialPhone, email, initialSmsEnabled = true }: Props) {
  const [fullName, setFullName] = useState(initialName ?? "");
  const [phone,    setPhone]    = useState(initialPhone ?? "");
  const [smsEnabled, setSmsEnabled] = useState<boolean>(initialSmsEnabled);
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const result = await updateProfile({ fullName, phone, smsNotificationsEnabled: smsEnabled });
    setLoading(false);
    if ("error" in result) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Profile updated successfully!" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Email (read-only) */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-charcoal-700">
          Email address
        </label>
        <input
          type="email"
          value={email ?? ""}
          readOnly
          className="w-full rounded-xl border border-border bg-ivory-100 px-3 py-2.5 text-sm text-charcoal-500 cursor-not-allowed"
        />
        <p className="mt-1 text-[11px] text-charcoal-400">Email cannot be changed here.</p>
      </div>

      {/* Full name */}
      <div>
        <label htmlFor="fullName" className="mb-1.5 block text-xs font-semibold text-charcoal-700">
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your full name"
          maxLength={100}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
        />
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="phone" className="mb-1.5 block text-xs font-semibold text-charcoal-700">
          Phone number
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          maxLength={15}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
        />
      </div>

      {/* SMS preference — non-critical messages only */}
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-ivory-50 p-3">
        <div>
          <p className="text-xs font-semibold text-charcoal-800">SMS updates</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-charcoal-500">
            Optional updates by SMS. Essential booking and payment messages are always sent.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={smsEnabled}
          aria-label="SMS updates"
          onClick={() => setSmsEnabled((v) => !v)}
          className={
            "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors " +
            (smsEnabled ? "bg-maroon-600" : "bg-charcoal-300")
          }
        >
          <span
            className={
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform " +
              (smsEnabled ? "translate-x-[22px]" : "translate-x-0.5")
            }
          />
        </button>
      </div>

      {/* Feedback */}
      {message && (
        <p
          className={
            "rounded-xl px-3 py-2 text-sm font-medium " +
            (message.type === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800")
          }
        >
          {message.text}
        </p>
      )}

      <Button type="submit" variant="default" disabled={loading} isLoading={loading}>
        Save Changes
      </Button>
    </form>
  );
}
