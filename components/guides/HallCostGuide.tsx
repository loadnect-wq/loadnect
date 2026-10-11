// ─────────────────────────────────────────────────────────────────────────────
// Guide: how much a wedding hall costs in Tamil Nadu
// (/guides/wedding-hall-cost-tamil-nadu and its Tamil twin). Searched as
// "marriage hall in madurai with price", "marriage hall rent in chennai",
// "kalyana mandapams in coimbatore with rates", "difference between banquet
// hall and marriage hall", "கல்யாண மண்டபம் வாடகை".
//
// THE ONLY PRICES ON THIS PAGE ARE HALLS' OWN LISTED PRICES. A city gets a
// row in the table once at least MIN_HALLS_FOR_CITY_PRICES of its live halls
// list a full-day price — the same three the occasion pages need before they
// are indexed. With one or two halls a "city price" would describe those
// halls, not the city, so below that the page says so instead of quoting
// anything. Everything else here explains the bill; none of it is a figure.
//
// The route fetches the listings and passes the rows in, so this component is
// pure and the page is ISR: a failed read throws there and the last good page
// stays up, rather than a page that says no city qualifies.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Search } from "lucide-react";
import { HALL_GST_PERCENT } from "@/lib/budget";
import { formatHallPrice, hasPrice } from "@/lib/booking-mode";
import { citySlug } from "@/lib/seo/cities";
import { tamilCityName } from "@/lib/seo/tamil";
import { formatDiaryDay } from "@/lib/diary";
import { guideBySlug, guidePath, guideText, type GuideLang } from "@/lib/guides";
import { MUHURTHAM_PATH } from "@/components/muhurtham/MuhurthamPage";
import { GuideSection, GuideShell, type GuideFaq, type RelatedLink } from "./GuideShell";

const GUIDE = guideBySlug("wedding-hall-cost-tamil-nadu");

/** A city's price range is shown only from this many halls with a listed full-day price. */
export const MIN_HALLS_FOR_CITY_PRICES = 3;

export type CityPriceRow = { city: string; slug: string; halls: number; from: number; to: number };

/** Listed full-day prices per city, for cities with enough priced halls. Halls priced "on request" are not counted. */
export function cityPriceRanges(
  halls: readonly { city: string; price_per_day: number | null }[],
  min = MIN_HALLS_FOR_CITY_PRICES,
): CityPriceRow[] {
  const byCity = new Map<string, number[]>();
  for (const h of halls) {
    if (!h.city || !hasPrice(h.price_per_day)) continue;
    byCity.set(h.city, [...(byCity.get(h.city) ?? []), h.price_per_day]);
  }
  return [...byCity.entries()]
    .filter(([, prices]) => prices.length >= min)
    .map(([city, prices]) => ({
      city,
      slug: citySlug(city),
      halls: prices.length,
      from: Math.min(...prices),
      to: Math.max(...prices),
    }))
    .sort((a, b) => a.city.localeCompare(b.city));
}

export function costLead(lang: GuideLang): string {
  return lang === "en"
    ? `It depends on the city, the date and the slot, and the rent a hall lists is rarely the whole bill. Ask each hall for its price for your date and slot, then check what it includes, whether GST at ${HALL_GST_PERCENT}% is added, and what electricity, the generator and cleaning cost on top. Below: what decides the price, what the bill can add, and real listed prices for every city where at least ${MIN_HALLS_FOR_CITY_PRICES} halls show one on Hallnect.`
    : `இது நகரம், தேதி, நேரம் (ஸ்லாட்) ஆகியவற்றைப் பொறுத்தது; மண்டபம் சொல்லும் வாடகை மட்டுமே மொத்தச் செலவு ஆகாது. உங்கள் தேதிக்கும் நேரத்துக்கும் ஒவ்வொரு மண்டபத்திடமும் விலை கேளுங்கள்; அதில் என்ன அடங்கும், ${HALL_GST_PERCENT}% GST சேருமா, மின்சாரம், ஜெனரேட்டர், சுத்தம் செய்தல் ஆகியவற்றுக்குத் தனிக் கட்டணம் உண்டா என்றும் பாருங்கள். கீழே: விலையைத் தீர்மானிப்பவை, பில்லில் சேரக்கூடியவை, Hallnect-இல் குறைந்தது ${MIN_HALLS_FOR_CITY_PRICES} மண்டபங்கள் விலை காட்டும் ஒவ்வொரு நகரத்தின் உண்மையான விலைகள்.`;
}

export function costFaqs(lang: GuideLang): GuideFaq[] {
  if (lang === "ta") {
    return [
      {
        q: "மண்டபம் சொல்லும் விலையில் GST அடங்குமா?",
        a: `எப்போதும் இல்லை. பல மண்டபங்கள் வாடகையுடன் ${HALL_GST_PERCENT}% GST சேர்க்கின்றன; சில GST சேர்த்த இறுதி விலையைச் சொல்கின்றன. ஒரே மாதிரி ஒப்பிட, ஒவ்வொரு மண்டபத்திடமும் இதைக் கேளுங்கள்.`,
      },
      {
        q: "பேங்க்வெட் ஹாலுக்கும் திருமண மண்டபத்துக்கும் என்ன வேறுபாடு?",
        a: "திருமண மண்டபம் பொதுவாகத் திருமணத்துக்காகவே கட்டப்படுகிறது: சடங்குக்கான மேடை, சாப்பாட்டுக் கூடம், சமையலறை, இரு குடும்பத்தினருக்கான அறைகள். பேங்க்வெட் ஹால் வரவேற்பு, விருந்து, கூட்டங்களுக்கான கூடம்; பெரும்பாலும் ஹோட்டலில் இருக்கும், சாப்பாடும் பொதுவாக அந்த இடத்திலிருந்தே வரும்.",
      },
      {
        q: "கல்யாண மண்டபம் என்பதற்கு ஆங்கிலத்தில் என்ன?",
        a: "Wedding hall, அல்லது marriage hall. தமிழ்நாடு முழுவதும் கல்யாண மண்டபம், திருமண மண்டபம் என்பவை திருமணத்துக்காகக் கட்டப்பட்ட கூடத்தையே குறிக்கின்றன.",
      },
      {
        q: "என் நகரத்துக்கான சராசரி விலை ஏன் இல்லை?",
        a: `Hallnect-இல் குறைந்தது ${MIN_HALLS_FOR_CITY_PRICES} மண்டபங்கள் விலை காட்டும் நகரத்துக்கு மட்டுமே விலை வரம்பைக் காட்டுகிறோம். அதற்குக் குறைவாக இருந்தால், அந்த எண் நகரத்தை அல்ல, ஓரிரு மண்டபங்களை மட்டுமே குறிக்கும்.`,
      },
    ];
  }
  return [
    {
      q: "Does a hall's listed price include GST?",
      a: `Not always. Many halls add GST at ${HALL_GST_PERCENT}% to the rent; others quote a final price that already includes it. Ask each hall which, so you compare like with like.`,
    },
    {
      q: "What is the difference between a banquet hall and a marriage hall?",
      a: "A marriage hall is usually built for weddings: a stage for the ceremony, a dining hall, a kitchen and rooms for the two families. A banquet hall is a hall for receptions, parties and meetings, often in a hotel, and the food usually comes from the venue.",
    },
    {
      q: "What does kalyana mandapam mean in English?",
      a: "A wedding hall, or marriage hall. Kalyanam means wedding and mandapam a hall; across Tamil Nadu the two words together mean a hall built for weddings.",
    },
    {
      q: "Why is there no average price for my city?",
      a: `We show a price range only for a city where at least ${MIN_HALLS_FOR_CITY_PRICES} halls list a price on Hallnect. With fewer, a figure would describe one or two halls, not the city.`,
    },
  ];
}

const COPY = {
  en: {
    pricesTitle: "Listed prices by city",
    pricesIntro: (asOf: string) => `Full-day prices as listed on Hallnect on ${asOf}. A hall's price for your date can differ, so ask it for a quote.`,
    colCity: "City",
    colHalls: "Halls with a price",
    colFrom: "From",
    colTo: "Up to",
    noPrices: `No city has ${MIN_HALLS_FOR_CITY_PRICES} halls with a listed price on Hallnect yet, so we do not quote a city figure: with one or two halls it would describe those halls, not the city. Each hall's own page shows its price.`,
    browse: "Browse halls and their prices",
    decidesTitle: "What decides the price",
    decides: [
      ["The slot", "Many halls charge less for a morning or an evening than for the full day. A hall's page on Hallnect shows its morning and evening prices where the hall sets them."],
      ["The date", "Muhurtham days fill first, so ask early for those dates."],
      ["The size", "A bigger hall, and a bigger dining hall, usually costs more."],
      ["What is included", "Air conditioning hours, the stage, chairs, rooms for the families and the kitchen may be in the rent or charged separately."],
    ] as const,
    billTitle: "What the bill can add to the rent",
    bill: [
      `GST at ${HALL_GST_PERCENT}%, if the hall charges it and its price is before tax.`,
      "Electricity and the generator, if they are billed separately.",
      "Cleaning, and hours beyond your slot.",
      "Decoration or the stage, if they are not in the rent.",
      "Food, if you use the hall's own caterer.",
    ],
    billNote: "Ask for every one of these in writing before you pay an advance.",
    billLink: "What to ask before you pay",
    namesTitle: "Marriage hall, banquet hall or kalyana mandapam?",
    names: "Kalyana mandapam is the name used across Tamil Nadu for a wedding hall: kalyanam means wedding and mandapam a hall. A marriage hall is usually built around a stage for the ceremony, with a dining hall, a kitchen and rooms for the two families. A banquet hall is a hall for receptions, parties and meetings, often in a hotel, where the food usually comes from the venue.",
    quoteTitle: "Get a real price",
    quote: "Ask a hall for a quote on Hallnect: tell it your date, the occasion and your guest count, and it replies with its price for that date, what is included and the advance it asks for. It sees your phone number only if you accept.",
    quoteCta: "Find a hall",
  },
  ta: {
    pricesTitle: "நகர வாரியாக மண்டப விலைகள்",
    pricesIntro: (asOf: string) => `${asOf} அன்று Hallnect-இல் உள்ள முழு நாள் விலைகள். உங்கள் தேதிக்கான விலை மாறலாம்; அதனால் மண்டபத்திடம் விலைப்புள்ளி கேளுங்கள்.`,
    colCity: "நகரம்",
    colHalls: "விலை காட்டும் மண்டபங்கள்",
    colFrom: "குறைந்தது",
    colTo: "அதிகபட்சம்",
    noPrices: `Hallnect-இல் எந்த நகரத்திலும் இன்னும் ${MIN_HALLS_FOR_CITY_PRICES} மண்டபங்கள் விலை காட்டவில்லை; அதனால் நகர விலையைச் சொல்வதில்லை. ஓரிரு மண்டபங்களை வைத்துச் சொன்னால் அது நகரத்தை அல்ல, அந்த மண்டபங்களை மட்டுமே குறிக்கும். ஒவ்வொரு மண்டபத்தின் பக்கத்திலும் அதன் விலை உள்ளது.`,
    browse: "மண்டபங்களையும் அவற்றின் விலைகளையும் பாருங்கள்",
    decidesTitle: "விலையைத் தீர்மானிப்பவை",
    decides: [
      ["நேரம் (ஸ்லாட்)", "பல மண்டபங்கள் முழு நாளை விடக் காலை அல்லது மாலைக்குக் குறைவாக வாங்குகின்றன. மண்டபம் காலை, மாலை விலைகளை வைத்திருந்தால், Hallnect-இல் அதன் பக்கத்தில் அவை இருக்கும்."],
      ["தேதி", "முகூர்த்த நாட்கள்தான் முதலில் நிரம்பும்; அந்தத் தேதிகளுக்கு முன்கூட்டியே கேளுங்கள்."],
      ["அளவு", "பெரிய மண்டபமும் பெரிய சாப்பாட்டுக் கூடமும் பொதுவாக அதிக விலை."],
      ["அதில் அடங்குபவை", "AC நேரம், மேடை, நாற்காலிகள், குடும்பத்தினருக்கான அறைகள், சமையலறை ஆகியவை வாடகையில் அடங்கலாம் அல்லது தனிக் கட்டணமாக இருக்கலாம்."],
    ] as const,
    billTitle: "வாடகைக்கு மேல் பில்லில் சேரக்கூடியவை",
    bill: [
      `${HALL_GST_PERCENT}% GST, மண்டபம் GST வசூலித்து, அதன் விலை வரிக்கு முந்தையதாக இருந்தால்.`,
      "மின்சாரமும் ஜெனரேட்டரும், தனியாகக் கணக்கிடப்பட்டால்.",
      "சுத்தம் செய்தல், உங்கள் நேரத்துக்கு மேல் கூடுதல் மணி நேரங்கள்.",
      "அலங்காரம் அல்லது மேடை, வாடகையில் அடங்காவிட்டால்.",
      "சாப்பாடு, மண்டபத்தின் சொந்த கேட்டரரைப் பயன்படுத்தினால்.",
    ],
    billNote: "முன்பணம் கட்டும் முன் இவை ஒவ்வொன்றையும் எழுத்தில் வாங்குங்கள்.",
    billLink: "கட்டும் முன் கேட்க வேண்டியவை",
    namesTitle: "திருமண மண்டபம், பேங்க்வெட் ஹால், கல்யாண மண்டபம்",
    names: "கல்யாண மண்டபம், திருமண மண்டபம் என்பவை தமிழ்நாடு முழுவதும் திருமணத்துக்காகக் கட்டப்பட்ட கூடத்தைக் குறிக்கின்றன. அது பொதுவாகச் சடங்குக்கான மேடையைச் சுற்றிக் கட்டப்பட்டு, சாப்பாட்டுக் கூடம், சமையலறை, இரு குடும்பத்தினருக்கான அறைகளுடன் இருக்கும். பேங்க்வெட் ஹால் வரவேற்பு, விருந்து, கூட்டங்களுக்கான கூடம்; பெரும்பாலும் ஹோட்டலில் இருக்கும், சாப்பாடும் பொதுவாக அந்த இடத்திலிருந்தே வரும்.",
    quoteTitle: "உண்மையான விலையைக் கேளுங்கள்",
    quote: "Hallnect-இல் மண்டபத்திடம் விலைப்புள்ளி கேளுங்கள்: உங்கள் தேதி, நிகழ்வு, விருந்தினர் எண்ணிக்கையைச் சொன்னால், அந்தத் தேதிக்கான விலை, அதில் அடங்குபவை, கேட்கும் முன்பணம் ஆகியவற்றுடன் பதில் வரும். நீங்கள் ஏற்றுக்கொண்டால் மட்டுமே மண்டபத்துக்கு உங்கள் தொலைபேசி எண் தெரியும்.",
    quoteCta: "மண்டபம் தேடுங்கள்",
  },
} as const;

function related(lang: GuideLang): RelatedLink[] {
  const advance = guideBySlug("before-you-pay-a-hall-advance");
  const expenses = guideBySlug("wedding-expense-list");
  return [
    { href: guidePath(expenses.slug, lang), label: guideText(expenses, lang).heading, note: guideText(expenses, lang).card },
    lang === "en"
      ? { href: MUHURTHAM_PATH.en, label: "Muhurtham dates", note: "Tamil wedding dates for the year ahead, with how many halls are already booked on each." }
      : { href: MUHURTHAM_PATH.ta, label: "முகூர்த்த நாட்கள்", note: "வரும் ஆண்டின் திருமண முகூர்த்த நாட்கள், ஒவ்வொரு நாளிலும் ஏற்கனவே முன்பதிவான மண்டபங்களுடன்." },
    { href: guidePath(advance.slug, lang), label: guideText(advance, lang).heading, note: guideText(advance, lang).card },
  ];
}

export function HallCostGuide({ lang, rows, asOf }: { lang: GuideLang; rows: readonly CityPriceRow[]; asOf: string }) {
  const c = COPY[lang];
  const advance = guideBySlug("before-you-pay-a-hall-advance");
  return (
    <GuideShell guide={GUIDE} lang={lang} lead={costLead(lang)} faqs={costFaqs(lang)} related={related(lang)}>
      <GuideSection id="city-prices" title={c.pricesTitle}>
        {rows.length > 0 ? (
          <>
            <p>{c.pricesIntro(formatDiaryDay(lang, asOf, { year: true }))}</p>
            <div className="overflow-x-auto rounded-2xl bg-white shadow-card ring-1 ring-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-ivory-100 text-xs uppercase tracking-wide text-charcoal-600">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{c.colCity}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{c.colHalls}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{c.colFrom}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{c.colTo}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.slug}>
                      <th scope="row" className="px-4 py-2.5 font-semibold text-charcoal-900">
                        <Link href={`${lang === "ta" ? "/ta" : ""}/wedding-halls/${r.slug}`} className="text-maroon-700 hover:underline">
                          {lang === "ta" ? tamilCityName(r.city) ?? r.city : r.city}
                        </Link>
                      </th>
                      <td className="px-4 py-2.5 tabular-nums text-charcoal-800">{r.halls}</td>
                      <td className="px-4 py-2.5 tabular-nums text-charcoal-900">{formatHallPrice(r.from)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-charcoal-900">{formatHallPrice(r.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>{c.noPrices}</p>
        )}
        <Link href="/halls" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-maroon-700 hover:underline">
          {c.browse} →
        </Link>
      </GuideSection>

      <GuideSection id="what-decides" title={c.decidesTitle}>
        <ul className="grid gap-2.5">
          {c.decides.map(([title, text]) => (
            <li key={title} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <span className="block text-sm font-semibold text-charcoal-900">{title}</span>
              <span className="mt-0.5 block text-sm text-charcoal-700">
                {text}
                {title === c.decides[1][0] && (
                  <>
                    {" "}
                    <Link href={MUHURTHAM_PATH[lang]} className="font-medium text-maroon-700 hover:underline">
                      {lang === "en" ? "Muhurtham dates" : "முகூர்த்த நாட்கள்"}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </GuideSection>

      <GuideSection id="the-bill" title={c.billTitle}>
        <ul className="list-disc space-y-1.5 pl-5">
          {c.bill.map((b) => <li key={b}>{b}</li>)}
        </ul>
        <p>
          {c.billNote}{" "}
          <Link href={guidePath(advance.slug, lang)} className="font-medium text-maroon-700 hover:underline">{c.billLink}</Link>
        </p>
      </GuideSection>

      <GuideSection id="hall-names" title={c.namesTitle}>
        <p>{c.names}</p>
      </GuideSection>

      <GuideSection id="real-price" title={c.quoteTitle}>
        <p>{c.quote}</p>
        <Link
          href="/halls"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          <Search className="h-4 w-4" aria-hidden /> {c.quoteCta}
        </Link>
      </GuideSection>
    </GuideShell>
  );
}
