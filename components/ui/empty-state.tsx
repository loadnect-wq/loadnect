import { cn } from "@/lib/utils";
import { HTMLAttributes, ReactNode } from "react";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Visual size of the container */
  size?: "sm" | "default" | "lg";
}

const sizeClasses = {
  sm:      "py-10",
  default: "py-16",
  lg:      "py-24",
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {icon && (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-ivory-200 text-charcoal-400">
          {icon}
        </div>
      )}

      {/* Ornamental divider above title */}
      <div className="ornament-row mb-4 w-32 text-xs text-gold-400">✦</div>

      <h3 className="font-serif text-xl font-semibold text-foreground">
        {title}
      </h3>

      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
