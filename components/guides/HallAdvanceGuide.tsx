// ─────────────────────────────────────────────────────────────────────────────
// Guide: before you pay a hall advance (/guides/before-you-pay-a-hall-advance
// and its Tamil twin). Searched as "marriage hall booking", "wedding hall
// checklist", "marriage hall requirements", "marriage hall advance".
//
// EVERY HALLNECT FACT HERE IS READ FROM THE CODE THAT ENFORCES IT:
//   * the refund table is lib/refund-schedule.ts CUSTOMER_REFUND_SCHEDULE —
//     the same rows the checkout and the cancel dialog apply;
//   * the fee sentence is platformFeeDisclosure(), the checkout's own wording;
//   * "the hall sees your number only if you accept" and the quote's fields
//     (price, what is included, advance, valid until) are leadQuoteSchema;
//   * the online-booking section exists only while DIRECT_BOOKING_ENABLED.
// The twelve questions are general advice with no figures in them.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { CUSTOMER_REFUND_SCHEDULE } from "@/lib/refund-schedule";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import { HALL_GST_PERCENT } from "@/lib/budget";
import { guideBySlug, guidePath, type GuideLang } from "@/lib/guides";
import { GuideSection, GuideShell, type GuideFaq, type RelatedLink } from "./GuideShell";

const GUIDE = guideBySlug("before-you-pay-a-hall-advance");

type Question = { title: string; detail: string };

/** What to ask the hall. The index card says "twelve"; a test holds it to that. */
export const ADVANCE_QUESTIONS: Record<GuideLang, readonly Question[]> = {
  en: [
    { title: "The price for your date and slot", detail: "Full day, morning or evening. Ask for your actual date, because a hall's price can differ from day to day." },
    { title: "What the price includes", detail: "Chairs, the stage, the dining hall, the kitchen and utensils, rooms for the families, cleaning, and how many hours of air conditioning." },
    { title: "Whether GST is extra", detail: `Many halls add GST at ${HALL_GST_PERCENT}% to the rent; others quote a final price that includes it.` },
    { title: "Electricity and generator charges", detail: "Whether power and generator backup are billed separately, and how they are worked out." },
    { title: "When you get the hall, and when you leave", detail: "The check-in and check-out times, and how early the caterer and decorator can come in to set up." },
    { title: "Your own caterer and decorator", detail: "Whether you may bring your own or must use the hall's, and whether bringing your own costs extra." },
    { title: "How many guests it really holds", detail: "How many can sit in the hall, and how many the dining hall serves at one sitting." },
    { title: "Parking", detail: "How many cars it takes, and whether the parking is on the premises." },
    { title: "The advance and the balance", detail: "How much you pay now, how much later, and the date by which the balance is due." },
    { title: "What happens if either side cancels", detail: "How much of the advance comes back if you cancel, and what the hall pays back if it cancels on you." },
    { title: "A receipt for every payment", detail: "Showing the hall's name, your function's date and slot, the amount, and the date you paid." },
    { title: "The hall's rules", detail: "Time limits on music, rules about decoration, and anything else the hall does not allow." },
  ],
  ta: [
    { title: "உங்கள் தேதிக்கும் நேரத்துக்குமான விலை", detail: "முழு நாள், காலை அல்லது மாலை. நாளுக்கு நாள் விலை மாறலாம்; அதனால் உங்கள் சரியான தேதியைச் சொல்லிக் கேளுங்கள்." },
    { title: "விலையில் என்னென்ன அடங்கும்", detail: "நாற்காலிகள், மேடை, சாப்பாட்டுக் கூடம், சமையலறை, பாத்திரங்கள், குடும்பத்தினருக்கான அறைகள், சுத்தம் செய்தல், எத்தனை மணி நேரம் AC." },
    { title: "GST தனியா", detail: `பல மண்டபங்கள் வாடகையுடன் ${HALL_GST_PERCENT}% GST சேர்க்கின்றன; சில GST சேர்த்த இறுதி விலையைச் சொல்கின்றன.` },
    { title: "மின்சாரம், ஜெனரேட்டர் கட்டணம்", detail: "மின்சாரமும் ஜெனரேட்டரும் தனியாகக் கணக்கிடப்படுமா, எப்படிக் கணக்கிடப்படும் என்று கேளுங்கள்." },
    { title: "மண்டபம் எப்போது கைக்கு வரும், எப்போது காலி செய்ய வேண்டும்", detail: "உள்ளே வரும், வெளியேறும் நேரம்; கேட்டரரும் அலங்காரக்காரரும் எவ்வளவு முன்பே வந்து ஏற்பாடு செய்யலாம்." },
    { title: "உங்கள் சொந்த கேட்டரர், அலங்காரக்காரர்", detail: "நீங்களே அழைத்து வரலாமா, மண்டபத்தினுடையவரைத்தான் பயன்படுத்த வேண்டுமா, வெளியிலிருந்து அழைத்தால் கூடுதல் கட்டணம் உண்டா." },
    { title: "உண்மையில் எத்தனை பேர் அமரலாம்", detail: "மண்டபத்தில் எத்தனை பேர் அமரலாம், சாப்பாட்டுக் கூடத்தில் ஒரு பந்தியில் எத்தனை பேர் சாப்பிடலாம்." },
    { title: "வாகன நிறுத்தம்", detail: "எத்தனை கார்கள் நிறுத்தலாம், அது மண்டப வளாகத்துக்குள்ளேயா." },
    { title: "முன்பணமும் மீதித் தொகையும்", detail: "இப்போது எவ்வளவு, பின்னர் எவ்வளவு, மீதியை எந்தத் தேதிக்குள் கட்ட வேண்டும்." },
    { title: "யார் ரத்து செய்தாலும் என்ன ஆகும்", detail: "நீங்கள் ரத்து செய்தால் முன்பணத்தில் எவ்வளவு திரும்பக் கிடைக்கும், மண்டபம் ரத்து செய்தால் உங்களுக்கு என்ன திருப்பித் தரும்." },
    { title: "ஒவ்வொரு கட்டணத்துக்கும் ரசீது", detail: "மண்டபத்தின் பெயர், உங்கள் விழாத் தேதி, நேரம், தொகை, கட்டிய தேதி ஆகியவற்றுடன்." },
    { title: "மண்டபத்தின் விதிமுறைகள்", detail: "இசைக்கான நேரக் கட்டுப்பாடு, அலங்கார விதிகள், மண்டபம் அனுமதிக்காத மற்றவை." },
  ],
};

/** The published customer-cancellation schedule, as table rows. */
export function refundRows(lang: GuideLang): { when: string; back: string }[] {
  return CUSTOMER_REFUND_SCHEDULE.map((tier, i) => {
    const prev = CUSTOMER_REFUND_SCHEDULE[i - 1];
    const min = tier.minDaysBeforeEvent;
    let when: string;
    if (!prev) {
      when = lang === "en" ? `${min} days or more before the function` : `விழாவுக்கு ${min} நாட்கள் அல்லது அதற்கு முன்`;
    } else if (min === 0) {
      when = lang === "en" ? `Less than ${prev.minDaysBeforeEvent} days before` : `${prev.minDaysBeforeEvent} நாட்களுக்குள்`;
    } else {
      const max = prev.minDaysBeforeEvent - 1;
      when = lang === "en" ? `${min} to ${max} days before` : `${min} முதல் ${max} நாட்கள் முன்`;
    }
    const back =
      tier.percentOfAdvance === 0
        ? lang === "en" ? "Nothing" : "எதுவும் இல்லை"
        : lang === "en" ? `${tier.percentOfAdvance}% of the advance` : `முன்பணத்தில் ${tier.percentOfAdvance}%`;
    return { when, back };
  });
}

export function advanceLead(lang: GuideLang): string {
  return lang === "en"
    ? "Before you pay anything, get the price, what it includes, the advance, the date the balance is due and the cancellation terms in writing. Visit the hall first, and look at the dining hall, the kitchen and the parking yourself."
    : "எதையும் கட்டும் முன், விலை, அதில் அடங்குபவை, முன்பணம், மீதியைக் கட்ட வேண்டிய தேதி, ரத்து விதிகள் எல்லாவற்றையும் எழுத்தில் வாங்குங்கள். முதலில் மண்டபத்தை நேரில் சென்று பாருங்கள்; சாப்பாட்டுக் கூடம், சமையலறை, வாகன நிறுத்தம் ஆகியவற்றையும் நீங்களே பாருங்கள்.";
}

export function advanceFaqs(lang: GuideLang): GuideFaq[] {
  if (lang === "ta") {
    return [
      {
        q: "திருமண மண்டபம் எவ்வளவு முன்பணம் கேட்கும்?",
        a: "ஒவ்வொரு மண்டபத்துக்கும் வேறுபடும். Hallnect-இல் ஒரு மண்டபத்தின் விலைப்புள்ளியில் அது கேட்கும் முன்பணம் இருக்கும்; ஆன்லைனில் முன்பணம் வாங்கும் மண்டபம், நீங்கள் கட்டும் முன்பே அந்தத் தொகையைக் காட்டும்.",
      },
      {
        q: "மண்டப முன்பணம் திரும்பக் கிடைக்குமா?",
        a: DIRECT_BOOKING_ENABLED
          ? "ஒப்புக்கொண்ட விதிகளின்படி மட்டுமே. Hallnect வழியாக ஆன்லைனில் முன்பதிவு செய்தால் மேலே உள்ள அட்டவணை பொருந்தும்; மண்டபத்துக்கு நேரடியாகக் கட்டினால் அந்த மண்டபத்தின் விதிகள் பொருந்தும். அதனால் கட்டும் முன் அவற்றை எழுத்தில் வாங்குங்கள்."
          : "ஒப்புக்கொண்ட விதிகளின்படி மட்டுமே. மண்டபத்துக்கு நேரடியாகக் கட்டுவதால் அந்த மண்டபத்தின் விதிகள் பொருந்தும்; அதனால் கட்டும் முன் அவற்றை எழுத்தில் வாங்குங்கள்.",
      },
      {
        q: "முன்பணம் கட்டும் முன் மண்டபத்தை நேரில் பார்க்க வேண்டுமா?",
        a: "ஆம். மண்டபம், சாப்பாட்டுக் கூடம், சமையலறை, வாகன நிறுத்தம் எல்லாவற்றையும் நீங்களே பாருங்கள். Hallnect-இல் மண்டபத்தின் பக்கத்தில் “Visit” என்பதைத் தட்டினால், நேரம் முடிவு செய்ய மண்டபம் உங்களை அழைக்கும்.",
      },
    ];
  }
  return [
    {
      q: "How much advance does a wedding hall ask for?",
      a: "It differs from hall to hall. On Hallnect, a hall's quote states the advance it asks for, and a hall that takes an online advance shows the amount before you pay.",
    },
    {
      q: "Is a hall advance refundable?",
      a: DIRECT_BOOKING_ENABLED
        ? "Only on the terms you agreed. On an online booking through Hallnect, the schedule above applies; when you pay a hall directly, its own terms apply, so get them in writing before you pay."
        : "Only on the terms you agreed. You pay the hall directly, so its own terms apply: get them in writing before you pay.",
    },
    {
      q: "Should we visit the hall before paying the advance?",
      a: "Yes. Look at the hall, the dining hall, the kitchen and the parking yourself. On Hallnect, tap “Visit” on the hall's page and the hall calls you to fix a time.",
    },
  ];
}

const COPY = {
  en: {
    askTitle: (n: number) => `${n} things to ask the hall`,
    visitTitle: "See it before you pay",
    visit: "Visit the hall before you pay anything, ideally at the time of day your function will be. On Hallnect, tap “Visit” on a hall's page to ask for a visit, and the hall calls you to fix a time.",
    writingTitle: "Get it in writing",
    writing: "On Hallnect, ask a hall for a quote. Its reply states the price for your date, what is included, the advance it asks for and how long the offer stands, and the hall sees your phone number only if you accept. When you pay a hall directly, ask for its refund terms in writing and a receipt for every payment.",
    onlineTitle: "If the hall takes an online advance on Hallnect",
    online: "Some halls on Hallnect take the advance online. If you cancel, this part of the advance is refunded:",
    colWhen: "When you cancel",
    colBack: "What you get back",
    fee: `The ${platformFeeDisclosure()} is not refunded when you cancel. If the hall or Hallnect cancels, you get the whole advance and the fee back.`,
    policies: "The full terms are in the",
    refund: "refund policy",
    and: "and the",
    cancel: "cancellation policy",
  },
  ta: {
    askTitle: (n: number) => `மண்டபத்திடம் கேட்க வேண்டிய ${n} கேள்விகள்`,
    visitTitle: "கட்டும் முன் நேரில் பாருங்கள்",
    visit: "எதையும் கட்டும் முன் மண்டபத்தை நேரில் பாருங்கள்; முடிந்தால் உங்கள் விழா நடக்கும் அதே நேரத்தில். Hallnect-இல் மண்டபத்தின் பக்கத்தில் “Visit” என்பதைத் தட்டினால், நேரம் முடிவு செய்ய மண்டபம் உங்களை அழைக்கும்.",
    writingTitle: "எழுத்தில் வாங்குங்கள்",
    writing: "Hallnect-இல் மண்டபத்திடம் விலைப்புள்ளி கேளுங்கள். அதன் பதிலில் உங்கள் தேதிக்கான விலை, அதில் அடங்குபவை, கேட்கும் முன்பணம், அந்த விலை எதுவரை செல்லும் என்பது இருக்கும்; நீங்கள் ஏற்றுக்கொண்டால் மட்டுமே மண்டபத்துக்கு உங்கள் தொலைபேசி எண் தெரியும். மண்டபத்துக்கு நேரடியாகக் கட்டினால், அதன் பணம் திருப்பித் தரும் விதிகளை எழுத்தில் வாங்குங்கள்; ஒவ்வொரு கட்டணத்துக்கும் ரசீது வாங்குங்கள்.",
    onlineTitle: "மண்டபம் Hallnect-இல் ஆன்லைனில் முன்பணம் வாங்கினால்",
    online: "Hallnect-இல் சில மண்டபங்கள் முன்பணத்தை ஆன்லைனில் வாங்குகின்றன. நீங்கள் ரத்து செய்தால், முன்பணத்தில் இவ்வளவு திரும்பக் கிடைக்கும்:",
    colWhen: "எப்போது ரத்து செய்கிறீர்கள்",
    colBack: "திரும்பக் கிடைப்பது",
    fee: `நீங்கள் ரத்து செய்தால் ${platformFeeDisclosure()} திரும்பக் கிடைக்காது. மண்டபமோ Hallnect-ஓ ரத்து செய்தால், முழு முன்பணமும் கட்டணமும் திரும்பக் கிடைக்கும்.`,
    policies: "முழு விதிகள்:",
    refund: "பணம் திருப்பித் தரும் கொள்கை",
    and: "மற்றும்",
    cancel: "ரத்துக் கொள்கை",
  },
} as const;

function related(lang: GuideLang): RelatedLink[] {
  const expenses = guideBySlug("wedding-expense-list");
  return lang === "en"
    ? [
        { href: guidePath(expenses.slug, "en"), label: expenses.en.heading, note: expenses.en.card },
        { href: "/halls", label: "Browse halls", note: "Compare halls by city, guests and price, then ask for a quote." },
      ]
    : [
        { href: guidePath(expenses.slug, "ta"), label: expenses.ta.heading, note: expenses.ta.card },
        { href: "/halls", label: "மண்டபங்களைப் பார்க்க", note: "நகரம், விருந்தினர், விலை வாரியாக மண்டபங்களை ஒப்பிட்டு, விலைப்புள்ளி கேளுங்கள்." },
      ];
}

export function HallAdvanceGuide({ lang }: { lang: GuideLang }) {
  const c = COPY[lang];
  const questions = ADVANCE_QUESTIONS[lang];
  return (
    <GuideShell guide={GUIDE} lang={lang} lead={advanceLead(lang)} faqs={advanceFaqs(lang)} related={related(lang)}>
      <GuideSection id="questions" title={c.askTitle(questions.length)}>
        <ul className="grid gap-2.5">
          {questions.map((q) => (
            <li key={q.title} className="flex gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-charcoal-900">{q.title}</span>
                <span className="mt-0.5 block text-sm text-charcoal-700">{q.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </GuideSection>

      <GuideSection id="visit" title={c.visitTitle}>
        <p>{c.visit}</p>
      </GuideSection>

      <GuideSection id="in-writing" title={c.writingTitle}>
        <p>{c.writing}</p>
      </GuideSection>

      {DIRECT_BOOKING_ENABLED && (
        <GuideSection id="online-advance" title={c.onlineTitle}>
          <p>{c.online}</p>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-card ring-1 ring-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-ivory-100 text-xs uppercase tracking-wide text-charcoal-600">
                <tr><th scope="col" className="px-4 py-2.5 font-semibold">{c.colWhen}</th><th scope="col" className="px-4 py-2.5 font-semibold">{c.colBack}</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {refundRows(lang).map((r) => (
                  <tr key={r.when}>
                    <td className="px-4 py-2.5 text-charcoal-800">{r.when}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums text-charcoal-900">{r.back}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>{c.fee}</p>
          <p>
            {c.policies}{" "}
            <Link href="/refund-policy" className="font-medium text-maroon-700 underline-offset-2 hover:underline">{c.refund}</Link>{" "}
            {c.and}{" "}
            <Link href="/cancellation-policy" className="font-medium text-maroon-700 underline-offset-2 hover:underline">{c.cancel}</Link>.
          </p>
        </GuideSection>
      )}
    </GuideShell>
  );
}
