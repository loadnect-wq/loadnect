// ─────────────────────────────────────────────────────────────────────────────
// Guide: the Tamil wedding expense list (/guides/wedding-expense-list and its
// Tamil twin). Searched as "marriage budget in tamil nadu", "tamil marriage
// budget worksheet", "திருமண செலவு பட்டியல்", "kalyana selavu list in tamil".
//
// THE LIST IS THE PLANNER'S. The groups are lib/plan.ts PLAN_CATEGORIES, in
// its order, so this page and the function planner can never disagree about
// what a wedding costs money for. A category added there without text here
// fails lib/__tests__/guides.test.ts.
//
// NO PRICES. Not one figure on this page is a claim about what anything costs:
// prices vary by city, season and supplier, and an "average" we cannot source
// would read as advice. The page says how to get a real number for each line,
// and the budget calculator adds up the family's own.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Calculator, ClipboardList } from "lucide-react";
import { PLAN_CATEGORIES, type PlanCategory } from "@/lib/plan";
import { HALL_GST_PERCENT } from "@/lib/budget";
import { BUDGET_PATH } from "@/lib/family-tools";
import { guideBySlug, guidePath, guideText, type GuideLang } from "@/lib/guides";
import { MUHURTHAM_PATH } from "@/components/muhurtham/MuhurthamPage";
import { GuideSection, GuideShell, type GuideFaq, type RelatedLink } from "./GuideShell";

const GUIDE = guideBySlug("wedding-expense-list");

/** Each planner category, in Tamil, and how to price it in both languages. */
export const EXPENSE_TEXT: Record<PlanCategory, { ta: { label: string; covers: string }; price: Record<GuideLang, string> }> = {
  hall: {
    ta: { label: "மண்டபம்", covers: "மண்டபமும், அது உங்களுக்காக ஒதுக்கும் தேதியும்" },
    price: {
      en: `Ask each hall for its price for your date and slot: full day, morning or evening. Ask too whether GST at ${HALL_GST_PERCENT}% is extra; some halls quote a final price that already includes it.`,
      ta: `உங்கள் தேதிக்கும் நேரத்துக்கும் (முழு நாள், காலை அல்லது மாலை) ஒவ்வொரு மண்டபத்திடமும் விலை கேளுங்கள். ${HALL_GST_PERCENT}% GST தனியா என்றும் கேளுங்கள்; சில மண்டபங்கள் GST சேர்த்த இறுதி விலையைச் சொல்லும்.`,
    },
  },
  catering: {
    ta: { label: "சாப்பாடு", covers: "ஒவ்வொரு வேளைக்குமான சாப்பாடு" },
    price: {
      en: "Ask the caterer for a per-plate rate for each meal, then multiply by your guests and the number of meals. For most families this is the biggest line, so fix the guest count early.",
      ta: "ஒவ்வொரு வேளைக்கும் ஒரு இலைக்கு எவ்வளவு என்று கேட்டரரிடம் கேளுங்கள்; அதை விருந்தினர் எண்ணிக்கையாலும் வேளைகளாலும் பெருக்குங்கள். பெரும்பாலான குடும்பங்களுக்கு இதுவே மிகப் பெரிய செலவு; அதனால் விருந்தினர் எண்ணிக்கையை முன்பே முடிவு செய்யுங்கள்.",
    },
  },
  decoration: {
    ta: { label: "அலங்காரம்", covers: "மேடை, நுழைவாயில், பூக்கள்" },
    price: {
      en: "Ask for one package price with a written list of what it includes: the stage, the entrance, flowers and lighting.",
      ta: "ஒரு மொத்த விலையும், அதில் என்னென்ன அடங்கும் என்ற எழுத்துப் பட்டியலும் கேளுங்கள்: மேடை, நுழைவாயில், பூக்கள், விளக்குகள்.",
    },
  },
  photo_video: {
    ta: { label: "புகைப்படம், வீடியோ", covers: "புகைப்படக்காரர், வீடியோ, ஆல்பம்" },
    price: {
      en: "Ask whether the album, the edited video and any extra cameras are in the price, and when you will receive them.",
      ta: "ஆல்பம், எடிட் செய்த வீடியோ, கூடுதல் கேமராக்கள் விலையில் அடங்குமா, அவை எப்போது கைக்கு வரும் என்று கேளுங்கள்.",
    },
  },
  makeup: {
    ta: { label: "மேக்கப், மெஹந்தி", covers: "மணமகள், மணமகன், குடும்பத்தினருக்கு" },
    price: {
      en: "Ask for a price per person or for a package, and whether a trial session and travel are extra.",
      ta: "ஒருவருக்கு எவ்வளவு, அல்லது மொத்தத் தொகுப்புக்கு எவ்வளவு என்றும், முன்னோட்ட மேக்கப்பும் பயணச் செலவும் தனியா என்றும் கேளுங்கள்.",
    },
  },
  music: {
    ta: { label: "நாதஸ்வரம், மேளம், இசை", covers: "நாதஸ்வரம், மேளம், இசைக்குழு அல்லது DJ" },
    price: {
      en: "Ask for the price per session and how many hours a session lasts.",
      ta: "ஒரு நிகழ்வுக்கு எவ்வளவு, அது எத்தனை மணி நேரம் என்று கேளுங்கள்.",
    },
  },
  invitations: {
    ta: { label: "பத்திரிகை", covers: "அச்சிடுதலும், கொடுக்கச் செல்லுதலும்" },
    price: {
      en: "The price of one card times the number of cards, plus courier or travel to give them out.",
      ta: "ஒரு பத்திரிகையின் விலை × எண்ணிக்கை, அதோடு அவற்றைக் கொடுக்கச் செல்லும் பயணம் அல்லது கூரியர் செலவு.",
    },
  },
  return_gifts: {
    ta: { label: "தாம்பூலம், பரிசுகள்", covers: "விருந்தினருக்குத் தாம்பூலப் பைகளும் பரிசுகளும்" },
    price: {
      en: "The price of one bag times the number of families or guests you will give one to.",
      ta: "ஒரு பையின் விலை × நீங்கள் கொடுக்கப்போகும் குடும்பங்கள் அல்லது விருந்தினர் எண்ணிக்கை.",
    },
  },
  priest: {
    ta: { label: "புரோகிதர், சடங்குகள்", covers: "புரோகிதரும், சடங்குகளுக்குத் தேவையானவையும்" },
    price: {
      en: "Ask the priest what the rituals need, and whether those materials are included in the fee.",
      ta: "சடங்குகளுக்கு என்ன தேவை, அந்தப் பொருட்கள் கட்டணத்தில் அடங்குமா என்று புரோகிதரிடம் கேளுங்கள்.",
    },
  },
  transport: {
    ta: { label: "கார், போக்குவரத்து", covers: "குடும்பத்தினருக்கும் விருந்தினருக்கும் கார்கள்" },
    price: {
      en: "Ask for a price per car per day, and what you pay beyond the kilometres or hours it includes.",
      ta: "ஒரு காருக்கு ஒரு நாளுக்கு எவ்வளவு, சேர்த்துள்ள கிலோமீட்டர் அல்லது மணி நேரத்துக்கு மேல் எவ்வளவு என்று கேளுங்கள்.",
    },
  },
  other: {
    ta: { label: "உடை, நகை, மற்றவை", covers: "உடைகள், நகைகள், மற்ற எல்லாமும்" },
    price: {
      en: "Write down each item with the amount you plan to spend, so nothing large arrives as a surprise.",
      ta: "ஒவ்வொன்றையும், செலவழிக்க நினைக்கும் தொகையுடன் எழுதி வையுங்கள்; பெரிய செலவு எதுவும் திடீரென வராது.",
    },
  },
};

/** The groups, in the planner's order, in one language. */
export function expenseGroups(lang: GuideLang) {
  return PLAN_CATEGORIES.map((c) => ({
    key: c.key,
    label: lang === "en" ? c.label : EXPENSE_TEXT[c.key].ta.label,
    covers: lang === "en" ? c.hint : EXPENSE_TEXT[c.key].ta.covers,
    price: EXPENSE_TEXT[c.key].price[lang],
  }));
}

/** The answer, first. Counted from the list, so it cannot say eleven when there are twelve. */
export function expenseLead(lang: GuideLang): string {
  const n = PLAN_CATEGORIES.length;
  return lang === "en"
    ? `A Tamil wedding's costs fall into ${n} groups: the hall, food for every guest, decoration, photos and video, makeup, music, invitations, return gifts, the priest, cars, and everything else. For most families the food and the hall decide the total. Get a real quote for each line, then add them up in the budget calculator.`
    : `தமிழ் திருமணச் செலவுகள் ${n} வகைகளில் அடங்கும்: மண்டபம், எல்லா விருந்தினருக்கும் சாப்பாடு, அலங்காரம், புகைப்படம் மற்றும் வீடியோ, மேக்கப், இசை, பத்திரிகை, தாம்பூலம், புரோகிதர், கார்கள், மற்றவை. பெரும்பாலான குடும்பங்களுக்கு சாப்பாடும் மண்டபமும்தான் மொத்தச் செலவைத் தீர்மானிக்கின்றன. ஒவ்வொன்றுக்கும் உண்மையான விலைப்புள்ளி வாங்கி, பட்ஜெட் கால்குலேட்டரில் கூட்டிப் பாருங்கள்.`;
}

export function expenseFaqs(lang: GuideLang): GuideFaq[] {
  if (lang === "ta") {
    return [
      {
        q: "தமிழ் திருமணத்தில் மிகப் பெரிய செலவு எது?",
        a: "பெரும்பாலான குடும்பங்களுக்குச் சாப்பாடுதான்: ஒரு இலைக்கான கட்டணம் × எல்லா விருந்தினரும் × பரிமாறும் வேளைகள். விருந்தினர் எண்ணிக்கையை முன்பே முடிவு செய்யுங்கள்; சாப்பாட்டுச் செலவையும், தேவையான மண்டப அளவையும் அதுவே தீர்மானிக்கிறது.",
      },
      {
        q: "திருமண மண்டப வாடகைக்கு GST உண்டா?",
        a: `பல மண்டபங்கள் வாடகையுடன் ${HALL_GST_PERCENT}% GST சேர்க்கின்றன; சில GST சேர்த்த இறுதி விலையைச் சொல்கின்றன. ஒப்பிடும் முன் ஒவ்வொரு மண்டபத்திடமும் இதைக் கேளுங்கள்.`,
      },
      {
        q: "இந்தப் பட்டியலில் ஏன் விலைகள் இல்லை?",
        a: "நகரம், பருவம், மண்டபம் என விலைகள் மாறுகின்றன; உறுதிப்படுத்த முடியாத எண்ணை நாங்கள் வெளியிடுவதில்லை. அதற்குப் பதிலாக விலைப்புள்ளி கேளுங்கள்: Hallnect-இல் ஒரு மண்டபத்தின் விலைப்புள்ளியில் விலை, அதில் அடங்குபவை, கேட்கும் முன்பணம் எல்லாம் இருக்கும்.",
      },
    ];
  }
  return [
    {
      q: "What is the biggest cost of a Tamil wedding?",
      a: "For most families it is the food: the per-plate rate times every guest, for every meal you serve. Fix the guest count early, because it decides the food bill and the size of hall you need.",
    },
    {
      q: "Is GST charged on wedding hall rent?",
      a: `Many halls add GST at ${HALL_GST_PERCENT}% to the rent; others quote a final price that already includes it. Ask each hall which, so you compare like with like.`,
    },
    {
      q: "Why does this list give no prices?",
      a: "Prices change with the city, the season and the hall, and we do not publish a figure we cannot back. Ask for quotes instead: on Hallnect a hall's quote shows its price, what is included and the advance it asks for.",
    },
  ];
}

const COPY = {
  en: {
    listTitle: "The expense list",
    covers: "What it covers",
    price: "How to price it",
    sumTitle: "Add it up",
    sum: `Hall rent, plus GST if the hall adds it; food, which is the per-plate rate times your guests times the meals you serve; then decoration and everything else. The budget calculator does this sum for you and shows the cost per guest. Your numbers stay in your browser.`,
    sumCta: "Open the budget calculator",
    trackTitle: "Keep track as you book",
    track: "The function planner keeps one line for each of these groups, with what you planned to spend, what you were quoted and what you have paid, plus a checklist you can change. It needs a free sign-in, so the whole family can share one plan.",
    trackCta: "Start a plan",
  },
  ta: {
    listTitle: "செலவுப் பட்டியல்",
    covers: "இதில் அடங்குபவை",
    price: "விலை கேட்கும் முறை",
    sumTitle: "கூட்டிப் பாருங்கள்",
    sum: "மண்டப வாடகை, மண்டபம் GST சேர்த்தால் அதுவும்; சாப்பாடு, அதாவது ஒரு இலைக்கான கட்டணம் × விருந்தினர் × வேளைகள்; பிறகு அலங்காரமும் மற்றவையும். பட்ஜெட் கால்குலேட்டர் இந்தக் கூட்டலைச் செய்து, ஒரு விருந்தினருக்கு ஆகும் செலவையும் காட்டும் (ஆங்கிலத்தில்). உங்கள் எண்கள் உங்கள் உலாவியிலேயே இருக்கும்.",
    sumCta: "பட்ஜெட் கால்குலேட்டரைத் திறக்க",
    trackTitle: "முன்பதிவு செய்யும்போதே கணக்கு வையுங்கள்",
    track: "ஃபங்ஷன் பிளானர் இந்த ஒவ்வொரு வகைக்கும் ஒரு வரி வைத்திருக்கும்: செலவழிக்க நினைத்தது, விலைப்புள்ளியில் வந்தது, கட்டியது; அதோடு நீங்கள் மாற்றக்கூடிய ஒரு சரிபார்ப்புப் பட்டியலும் (ஆங்கிலத்தில்). முழுக் குடும்பமும் ஒரே திட்டத்தைப் பகிர இலவசமாக உள்நுழைய வேண்டும்.",
    trackCta: "திட்டத்தைத் தொடங்க",
  },
} as const;

function related(lang: GuideLang): RelatedLink[] {
  const advance = guideBySlug("before-you-pay-a-hall-advance");
  return lang === "en"
    ? [
        { href: guidePath(advance.slug, "en"), label: advance.en.heading, note: advance.en.card },
        { href: MUHURTHAM_PATH.en, label: "Muhurtham dates", note: "Tamil wedding dates for the year ahead, with how many halls are already booked on each." },
      ]
    : [
        { href: guidePath(advance.slug, "ta"), label: guideText(advance, "ta").heading, note: guideText(advance, "ta").card },
        { href: MUHURTHAM_PATH.ta, label: "முகூர்த்த நாட்கள்", note: "வரும் ஆண்டின் திருமண முகூர்த்த நாட்கள், ஒவ்வொரு நாளிலும் ஏற்கனவே முன்பதிவான மண்டபங்களுடன்." },
      ];
}

export function ExpenseListGuide({ lang }: { lang: GuideLang }) {
  const c = COPY[lang];
  const groups = expenseGroups(lang);
  return (
    <GuideShell guide={GUIDE} lang={lang} lead={expenseLead(lang)} faqs={expenseFaqs(lang)} related={related(lang)}>
      <GuideSection id="expense-list" title={c.listTitle}>
        <ul className="grid gap-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <h3 className="text-base font-bold text-charcoal-900">{g.label}</h3>
              <p className="mt-1 text-sm text-charcoal-700">
                <span className="font-semibold text-charcoal-800">{c.covers}: </span>
                {g.covers}
              </p>
              <p className="mt-1 text-sm text-charcoal-700">
                <span className="font-semibold text-charcoal-800">{c.price}: </span>
                {g.price}
              </p>
            </li>
          ))}
        </ul>
      </GuideSection>

      <GuideSection id="add-it-up" title={c.sumTitle}>
        <p>{c.sum}</p>
        <Link
          href={BUDGET_PATH}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800"
        >
          <Calculator className="h-4 w-4" aria-hidden /> {c.sumCta}
        </Link>
      </GuideSection>

      <GuideSection id="keep-track" title={c.trackTitle}>
        <p>{c.track}</p>
        <Link
          href="/plan"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-maroon-700 ring-1 ring-maroon-200 hover:bg-maroon-50"
        >
          <ClipboardList className="h-4 w-4" aria-hidden /> {c.trackCta}
        </Link>
      </GuideSection>
    </GuideShell>
  );
}
