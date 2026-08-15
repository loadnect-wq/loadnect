import { cn } from "@/lib/utils";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";

type SeparatorVariant = "default" | "gold" | "maroon" | "dashed";

interface SeparatorProps
  extends ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  variant?: SeparatorVariant;
}

const variantClass: Record<SeparatorVariant, string> = {
  default: "bg-border",
  gold:    "bg-gradient-to-r from-transparent via-gold-400 to-transparent",
  maroon:  "bg-gradient-to-r from-transparent via-maroon-300 to-transparent",
  dashed:  "border-0 border-t border-dashed border-border bg-transparent",
};

const Separator = forwardRef<
  ElementRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(({ className, orientation = "horizontal", decorative = true, variant = "default", ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      variantClass[variant],
      className
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
