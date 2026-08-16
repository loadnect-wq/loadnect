import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ButtonHTMLAttributes, forwardRef } from "react";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-all duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        // Maroon primary – main CTAs
        default:
          "bg-maroon-600 text-ivory-100 hover:bg-maroon-700 shadow-maroon active:bg-maroon-800",
        // Destructive – delete / cancel
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Maroon outline – secondary action
        outline:
          "border border-maroon-600 bg-transparent text-maroon-700 hover:bg-maroon-50 hover:text-maroon-800",
        // Ivory / champagne – soft secondary
        secondary:
          "bg-ivory-200 text-charcoal-800 hover:bg-ivory-300",
        // Royal gold gradient – premium / featured CTA
        gold:
          "bg-gold-gradient text-white shadow-sm hover:opacity-90 active:opacity-100",
        // Ghost – subtle, no background
        ghost:
          "bg-transparent text-charcoal-700 hover:bg-maroon-50 hover:text-maroon-700",
        // Link-style
        link:
          "h-auto p-0 text-maroon-700 underline-offset-4 hover:underline",
      },
      size: {
        sm:      "min-h-[44px] lg:min-h-0 lg:h-8 rounded-md px-3.5 py-1.5 text-xs",
        default: "min-h-[44px] lg:min-h-0 lg:h-10 rounded-lg px-5 py-2.5 text-sm",
        lg:      "h-12 rounded-xl px-8 py-3.5 text-base",
        xl:      "h-14 rounded-xl px-10 py-4 text-base",
        icon:    "h-11 w-11 lg:h-10 lg:w-10 rounded-lg",
        "icon-sm": "h-11 w-11 lg:h-8 lg:w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant,
      size,
      asChild = false,
      isLoading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {isLoading && (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {children}
      </Comp>
    );
  }
);

Button.displayName = "Button";
