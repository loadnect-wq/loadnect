"use client";

import { cn } from "@/lib/utils";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";

const ToastProvider = ToastPrimitives.Provider;

// ─── Viewport (portal target) ────────────────────────────────────────────────

const ToastViewport = forwardRef<
  ElementRef<typeof ToastPrimitives.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-[100]",
      "flex flex-col gap-2 p-4 sm:p-6",
      "w-full sm:max-w-sm md:max-w-[420px]",
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

// ─── Toast root ───────────────────────────────────────────────────────────────

const toastVariants = cva(
  [
    "group pointer-events-auto relative flex w-full items-start gap-3",
    "overflow-hidden rounded-xl border p-4 pr-8 shadow-elevated",
    "transition-all duration-200",
    "data-[swipe=cancel]:translate-x-0",
    "data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]",
    "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
    "data-[state=open]:animate-slide-up",
    "data-[state=closed]:opacity-0 data-[state=closed]:translate-y-1",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-border bg-card text-card-foreground",
        success:
          "border-green-300 bg-green-50 text-green-900",
        destructive:
          "border-red-300 bg-red-50 text-red-900",
        gold:
          "border-gold-400 bg-maroon-950 text-ivory-100",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface ToastProps
  extends ComponentPropsWithoutRef<typeof ToastPrimitives.Root>,
    VariantProps<typeof toastVariants> {}

const Toast = forwardRef<ElementRef<typeof ToastPrimitives.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
);
Toast.displayName = ToastPrimitives.Root.displayName;

// ─── Sub-components ───────────────────────────────────────────────────────────

const ToastAction = forwardRef<
  ElementRef<typeof ToastPrimitives.Action>,
  ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center justify-center rounded-md",
      "border border-current bg-transparent px-3 py-1.5 text-xs font-medium",
      "transition-colors hover:bg-background/20",
      "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = forwardRef<
  ElementRef<typeof ToastPrimitives.Close>,
  ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    toast-close=""
    className={cn(
      "absolute right-2 top-2 rounded-md p-1",
      "text-foreground/50 hover:text-foreground",
      "opacity-0 transition-opacity group-hover:opacity-100",
      "focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
      className
    )}
    aria-label="Close notification"
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = forwardRef<
  ElementRef<typeof ToastPrimitives.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("font-serif text-sm font-semibold leading-snug", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = forwardRef<
  ElementRef<typeof ToastPrimitives.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
