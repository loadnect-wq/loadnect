// Server component: renders ad(s) for a placement.
// Renders nothing if no active ads — never shows a placeholder, so empty slots
// disappear silently rather than breaking layout.
//
// Output safety:
//   • Text fields go through React (auto-escaped).
//   • Hrefs are re-validated here (defense in depth) — if the stored URL has
//     a non-http(s) scheme, the link is dropped and we render a plain image.
//   • rel="noopener noreferrer nofollow" on every outbound link.

import { fetchActiveAds } from "@/lib/ads-server";
import { validateTargetUrl, type AdPlacement } from "@/lib/ads";

type Props = {
  placement: AdPlacement;
  limit?:    number;
  variant?:  "banner" | "card";
  className?: string;
};

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const v = validateTargetUrl(raw);
  return v.ok ? v.url : null;
}

export async function AdSlot({ placement, limit = 1, variant = "banner", className }: Props) {
  const ads = await fetchActiveAds(placement, limit);
  if (ads.length === 0) return null;

  if (variant === "card") {
    return (
      <aside className={["space-y-3", className].filter(Boolean).join(" ")} aria-label="Sponsored">
        {ads.map((ad) => {
          const href = safeHref(ad.target_url);
          const img  = safeHref(ad.image_url);
          const inner = (
            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
              {img && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={img} alt="" className="h-32 w-full object-cover" />
              )}
              <div className="p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-charcoal-400">Sponsored</p>
                <p className="font-serif text-sm font-semibold text-charcoal-900 line-clamp-2">{ad.title}</p>
                {ad.advertiser_name && (
                  <p className="text-[11px] text-charcoal-500">{ad.advertiser_name}</p>
                )}
              </div>
            </div>
          );
          return href ? (
            <a key={ad.id} href={href} target="_blank" rel="noopener noreferrer nofollow" className="block">
              {inner}
            </a>
          ) : (
            <div key={ad.id}>{inner}</div>
          );
        })}
      </aside>
    );
  }

  // banner
  return (
    <aside className={["space-y-2", className].filter(Boolean).join(" ")} aria-label="Sponsored">
      {ads.map((ad) => {
        const href = safeHref(ad.target_url);
        const img  = safeHref(ad.image_url);
        const inner = (
          <div className="relative overflow-hidden rounded-xl border border-border bg-white shadow-card">
            {img && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={img} alt={ad.title} className="h-32 w-full object-cover sm:h-40" />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Sponsored</p>
                <p className="line-clamp-1 font-serif text-sm font-semibold">{ad.title}</p>
              </div>
              {ad.advertiser_name && (
                <p className="shrink-0 text-[11px] text-white/80">{ad.advertiser_name}</p>
              )}
            </div>
          </div>
        );
        return href ? (
          <a key={ad.id} href={href} target="_blank" rel="noopener noreferrer nofollow" className="block">
            {inner}
          </a>
        ) : (
          <div key={ad.id}>{inner}</div>
        );
      })}
    </aside>
  );
}
