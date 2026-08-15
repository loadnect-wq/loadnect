// Server component — reusable header for admin pages

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title:        string;
  description?: string;
  action?:      React.ReactNode;
}) {
  return (
    <div className="border-b border-border bg-white px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-xl font-bold text-charcoal-900 lg:text-2xl">{title}</h1>
          {description && (
            <p className="mt-0.5 text-xs text-charcoal-500 lg:text-sm">{description}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}
