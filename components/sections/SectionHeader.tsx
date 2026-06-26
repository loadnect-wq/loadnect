import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  ornament?: string;
  title: string;
  description?: string;
  centered?: boolean;
  light?: boolean;
  className?: string;
}

export function SectionHeader({
  ornament = "✦",
  title,
  description,
  centered = true,
  light = false,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn(centered && "text-center", className)}>
      <div className={cn("ornament-row mb-4 text-sm", light ? "text-gold-400" : "text-gold-500")}>
        {ornament}
      </div>
      <h2
        className={cn(
          "font-serif text-3xl font-semibold sm:text-4xl",
          light ? "text-ivory-100" : "text-foreground",
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "mx-auto mt-3 max-w-xl text-base leading-relaxed",
            light ? "text-ivory-400" : "text-muted-foreground",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
