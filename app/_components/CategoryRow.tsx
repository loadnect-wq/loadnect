import Link from "next/link";

interface Category {
  key: string;
  label: string;
  href: string;
  iconNode: React.ReactNode;
}

export function CategoryRow({ categories }: { categories: Category[] }) {
  return (
    <div className="no-scrollbar overflow-x-auto">
      <ul className="flex w-max gap-3 px-4 sm:px-6">
        {categories.map((c) => (
          <li key={c.key}>
            <Link
              href={c.href}
              className="flex w-20 flex-col items-center gap-1.5 rounded-2xl bg-white py-3 shadow-card transition-transform active:scale-95"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-maroon-50 to-rose-50 text-maroon-600">
                {c.iconNode}
              </span>
              <span className="px-1 text-center text-[10.5px] font-semibold leading-tight text-charcoal-800">
                {c.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
