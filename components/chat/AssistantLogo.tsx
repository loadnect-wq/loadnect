import Image from "next/image";

// The Hallnect "HN" monogram (public/logo.png, transparent PNG) as the
// assistant's avatar — the same mark the navbar uses, so the chat reads as part
// of the site rather than a third-party widget. Decorative: every place it
// appears already names the assistant in text or an aria-label.
export function AssistantLogo({ size, className = "" }: { size: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      // No `sizes`: with fixed width/height Next serves 1x/2x variants of this
      // tiny mark; `sizes` would switch to width descriptors up to 3840px.
      className={`object-contain ${className}`}
      aria-hidden
    />
  );
}
