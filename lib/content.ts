// Static content used across public pages.
// Keep data here so components stay logic-only.

// Tamil Nadu only. No fabricated venue counts — tiles link to the real search.
export const POPULAR_CITIES = [
  { name: "Madurai",          state: "Tamil Nadu", gradient: "linear-gradient(135deg,#6B1525 0%,#9B2038 100%)" },
  { name: "Chennai",          state: "Tamil Nadu", gradient: "linear-gradient(135deg,#831843 0%,#BE185D 100%)" },
  { name: "Coimbatore",       state: "Tamil Nadu", gradient: "linear-gradient(135deg,#064E3B 0%,#065F46 100%)" },
  { name: "Tiruchirappalli",  state: "Tamil Nadu", gradient: "linear-gradient(135deg,#78350F 0%,#B45309 100%)" },
  { name: "Salem",            state: "Tamil Nadu", gradient: "linear-gradient(135deg,#4C1D95 0%,#6D28D9 100%)" },
  { name: "Tirunelveli",      state: "Tamil Nadu", gradient: "linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 100%)" },
  { name: "Thanjavur",        state: "Tamil Nadu", gradient: "linear-gradient(135deg,#134E4A 0%,#0F766E 100%)" },
  { name: "Erode",            state: "Tamil Nadu", gradient: "linear-gradient(135deg,#1C1917 0%,#44403C 100%)" },
] as const;

export const TESTIMONIALS = [
  {
    id: "1",
    name: "Priya & Arjun",
    city: "Madurai",
    hallName: "Grand Lotus Mahal",
    rating: 5,
    text: "Hallnect made finding our dream venue effortless. We compared 12 halls in a single afternoon and booked within days. The verified listings gave us complete confidence.",
    weddingDate: "February 2024",
  },
  {
    id: "2",
    name: "Meera & Vikram",
    city: "Coimbatore",
    hallName: "Kovai Grand Mahal",
    rating: 5,
    text: "As a couple planning from a different city, Hallnect was a lifesaver. Detailed photos, transparent pricing, and instant confirmation — exactly what we needed.",
    weddingDate: "November 2023",
  },
  {
    id: "3",
    name: "Sunita & Rahul",
    city: "Chennai",
    hallName: "Marina Grand Convention",
    rating: 5,
    text: "We were amazed by the range of venues available. The customer support team answered every question promptly. Our wedding was absolutely perfect.",
    weddingDate: "January 2024",
  },
] as const;

export const FAQ_ITEMS = [
  {
    q: "How does Hallnect work?",
    a: "Browse verified wedding halls across Tamil Nadu, compare pricing and amenities, then request a booking directly through our platform. Once the owner confirms, you pay securely and receive instant confirmation.",
  },
  {
    q: "Are the listed venues verified?",
    a: "Yes. Every hall owner goes through our approval process before their listings go live. Our team reviews business credentials and on-site details to ensure quality.",
  },
  {
    q: "What is the platform fee?",
    a: "Hallnect charges a flat ₹200 platform fee, collected with your advance at checkout. It covers secure payment processing, booking support, and WhatsApp updates, and is shown clearly before you pay. The fee is non-refundable if you cancel; if the venue cancels on you, it is refunded in full.",
  },
  {
    q: "Can I cancel my booking?",
    a: "Yes. Cancellation terms depend on how far in advance you cancel. Full details are in our Cancellation Policy. Customers can cancel from their dashboard; refunds follow the refund schedule.",
  },
  {
    q: "How do I list my hall on Hallnect?",
    a: "Register as a Hall Owner, fill in your business details, and submit for review. Our team typically approves or responds within 24–48 hours. Once approved, you can create listings and start receiving bookings.",
  },
  {
    q: "What payment methods are accepted?",
    a: "We accept all major credit and debit cards, UPI, net banking, and popular wallets through our secure Cashfree payment integration. Your payment details are never stored on our servers.",
  },
  {
    q: "Is there a minimum booking duration?",
    a: "Each venue sets its own minimum. Most halls offer morning slots, evening slots, and full-day bookings. You can filter by slot type during your search.",
  },
  {
    q: "What happens if the owner cancels?",
    a: "In the rare case an owner cancels a confirmed booking, you receive a full refund within 3–5 business days and we help you find an alternative venue at no extra cost.",
  },
] as const;

export const PREMIUM_TIERS = [
  {
    id: "free",
    name: "Free",
    tagline: "Start listing your venue",
    priceMonthly: 0,
    durationLabel: "per month",
    features: [
      "Basic hall listing",
      "Up to 5 photos",
      "Standard search visibility",
      "Booking request management",
      "Basic support",
    ],
    isPopular: false,
    ctaLabel: "Get Started",
    ctaHref: "/owner/register",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Grow your bookings",
    priceMonthly: 4999,
    durationLabel: "per month",
    features: [
      "Everything in Free",
      "Featured badge on listing",
      "Priority search placement",
      "Up to 20 photos",
      "Basic analytics dashboard",
      "WhatsApp lead notifications (coming soon)",
    ],
    isPopular: true,
    ctaLabel: "Start Pro Plan",
    ctaHref: "/owner/register",
  },
  {
    id: "elite",
    name: "Elite",
    tagline: "Maximum visibility",
    priceMonthly: 9999,
    durationLabel: "per month",
    features: [
      "Everything in Pro",
      "Top placement in city search",
      "Homepage featured placement",
      "Advanced analytics and lead reports",
      "Promotional banner visibility",
      "Priority support",
    ],
    isPopular: false,
    ctaLabel: "Contact Sales",
    ctaHref: "/contact",
  },
] as const;

export const WHY_CHOOSE = [
  {
    icon: "shield-check",
    title: "Verified Venues",
    description: "Every listing is reviewed by our team. No fake addresses, no hidden surprises — just genuine venues you can trust.",
  },
  {
    icon: "indian-rupee",
    title: "Transparent Pricing",
    description: "See full pricing upfront — per slot, per day, and any add-ons. No hidden fees after you book.",
  },
  {
    icon: "clock",
    title: "Instant Confirmation",
    description: "Book in minutes. Once payment is confirmed, your booking is locked in with a digital guarantee.",
  },
  {
    icon: "headphones",
    title: "24/7 Support",
    description: "Our dedicated wedding concierge team is always on hand to help — before, during, and after your event.",
  },
  {
    icon: "map-pin",
    title: "Tamil Nadu Coverage",
    description: "From Madurai and Chennai to Coimbatore and beyond — discover halls across Tamil Nadu's cities and towns.",
  },
  {
    icon: "star",
    title: "Genuine Reviews",
    description: "Only couples with verified bookings can leave reviews. Real experiences, real ratings — no fakes.",
  },
] as const;

export const OWNER_BENEFITS = [
  { title: "Zero upfront cost",       description: "List your hall free. Pay only when you earn — we charge a small commission on confirmed bookings." },
  { title: "Manage from one place",   description: "Accept or reject booking requests, update availability, and track earnings all from your dashboard." },
  { title: "Reach more couples",      description: "Thousands of couples search Hallnect every day. Get discovered by customers you'd never reach on your own." },
  { title: "Secure payments",         description: "Cashfree-powered payments hit your account directly. We handle disputes so you focus on the event." },
] as const;
