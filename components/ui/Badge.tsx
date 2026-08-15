import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { HTMLAttributes } from "react";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-maroon-100 text-maroon-800 border border-maroon-200",
        secondary:   "bg-ivory-200 text-charcoal-700 border border-ivory-300",
        outline:     "border border-current bg-transparent text-charcoal-700",
        success:     "bg-green-100 text-green-800 border border-green-200",
        warning:     "bg-amber-100 text-amber-800 border border-amber-200",
        destructive: "bg-red-100 text-red-800 border border-red-200",
        // Gold – premium listings / featured halls
        gold:
          "bg-gold-gradient text-white border-0 shadow-sm",
        // Rose – new / special labels
        rose:
          "bg-rose-100 text-rose-800 border border-rose-200",
        // Ghost outline in brand maroon
        "outline-maroon":
          "border border-maroon-400 text-maroon-700 bg-transparent",
      },
      size: {
        sm:      "px-2 py-0.5 text-xs",
        default: "px-2.5 py-0.5 text-xs",
        md:      "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ variant, size, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </span>
  );
}
