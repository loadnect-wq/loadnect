"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { submitReview } from "@/app/customer/actions";

interface Props {
  hallId:    string;
  bookingId: string;
  hallName:  string;
}

const LABELS = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

const SUB_CATEGORIES = [
  { key: "cleanliness", label: "Cleanliness" },
  { key: "value",       label: "Value for Money" },
  { key: "location",    label: "Location" },
  { key: "service",     label: "Service" },
] as const;

function StarRow({
  value,
  hovered,
  onSelect,
  onHover,
  onLeave,
  size = "lg",
}: {
  value: number;
  hovered: number;
  onSelect: (n: number) => void;
  onHover: (n: number) => void;
  onLeave: () => void;
  size?: "lg" | "sm";
}) {
  const display = hovered || value;
  const cls = size === "lg" ? "h-8 w-8" : "h-5 w-5";
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onSelect(n)}
          onMouseEnter={() => onHover(n)}
          onMouseLeave={onLeave}
          aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
          className="transition-transform hover:scale-110 active:scale-95"
        >
          <Star
            className={
              cls + " " +
              (n <= display
                ? "fill-gold-500 text-gold-500"
                : "text-charcoal-300")
            }
          />
        </button>
      ))}
      {size === "lg" && value > 0 && (
        <span className="ml-2 text-sm font-medium text-charcoal-600">{LABELS[value]}</span>
      )}
    </div>
  );
}

export function ReviewForm({ hallId, bookingId, hallName }: Props) {
  const router  = useRouter();
  const [rating,   setRating]  = useState(0);
  const [hovered,  setHovered] = useState(0);
  const [title,    setTitle]   = useState("");
  const [comment,  setComment] = useState("");
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState<string | null>(null);
  const [done,     setDone]    = useState(false);

  const [subRatings, setSubRatings] = useState<Record<string, number>>({});
  const [subHovered, setSubHovered] = useState<Record<string, number>>({});

  if (done) {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
        <p className="text-sm font-semibold text-green-800">Thank you for your review!</p>
        <p className="mt-1 text-xs text-green-700">Your feedback helps other guests choose the right venue.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) { setError("Please select an overall rating."); return; }
    setLoading(true);
    setError(null);
    const result = await submitReview({
      hallId,
      bookingId,
      rating,
      title:             title.trim() || undefined,
      comment:           comment.trim() || undefined,
      cleanlinessRating: subRatings.cleanliness || undefined,
      valueRating:       subRatings.value       || undefined,
      locationRating:    subRatings.location     || undefined,
      serviceRating:     subRatings.service      || undefined,
    });
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
    } else {
      setDone(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-charcoal-700">
        How was your experience at <strong>{hallName}</strong>?
      </p>

      {/* Overall star rating */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-500 mb-1.5">
          Overall Rating
        </p>
        <StarRow
          value={rating}
          hovered={hovered}
          onSelect={setRating}
          onHover={setHovered}
          onLeave={() => setHovered(0)}
        />
      </div>

      {/* Sub-ratings */}
      <div className="grid grid-cols-2 gap-3">
        {SUB_CATEGORIES.map((cat) => (
          <div key={cat.key}>
            <p className="text-[11px] font-semibold text-charcoal-500 mb-1">{cat.label}</p>
            <StarRow
              value={subRatings[cat.key] ?? 0}
              hovered={subHovered[cat.key] ?? 0}
              onSelect={(n) => setSubRatings((prev) => ({ ...prev, [cat.key]: n }))}
              onHover={(n) => setSubHovered((prev) => ({ ...prev, [cat.key]: n }))}
              onLeave={() => setSubHovered((prev) => ({ ...prev, [cat.key]: 0 }))}
              size="sm"
            />
          </div>
        ))}
      </div>

      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Review title (optional)"
        maxLength={200}
        className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
      />

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Share details about your experience (optional)"
        maxLength={500}
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
      />

      {error && (
        <p className="text-xs font-medium text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" variant="default" size="sm" disabled={loading} isLoading={loading}>
        Submit Review
      </Button>
    </form>
  );
}
