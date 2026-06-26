import Link from "next/link";

interface City {
  name: string;
  state: string;
  count: number;
  gradient: string;
}

export function CitiesRow({ cities }: { cities: readonly City[] }) {
  return (
    <div className="no-scrollbar overflow-x-auto">
      <ul className="flex w-max gap-3 px-4 sm:px-6">
        {cities.map((c) => (
          <li key={c.name}>
            <Link
              href={`/halls?city=${c.name}`}
              className="relative block h-32 w-40 overflow-hidden rounded-2xl shadow-card transition-transform active:scale-95"
            >
              <div className="absolute inset-0" style={{ background: c.gradient }} aria-hidden />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-0 left-0 p-3 text-white">
                <p className="font-serif text-base font-bold">{c.name}</p>
                <p className="text-[10px] text-white/80">{c.count} halls</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
