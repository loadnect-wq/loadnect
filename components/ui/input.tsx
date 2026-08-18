import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // Layout
        // 44px minimum tap height on touch; lg: restores the compact desktop
        // density so existing desktop forms are visually unchanged.
        "flex min-h-[44px] lg:min-h-0 lg:h-10 w-full rounded-lg",
        // Colours
        "border border-input bg-background",
        "text-sm text-foreground",
        // Padding
        "px-3.5 py-2",
        // Placeholder
        "placeholder:text-muted-foreground",
        // Focus
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        // Transition
        "transition-colors duration-150",
        // Disabled
        "disabled:cursor-not-allowed disabled:opacity-50",
        // File input
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
