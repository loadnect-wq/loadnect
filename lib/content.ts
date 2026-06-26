// Static content used across public pages.
// Keep data here so components stay logic-only.

export const POPULAR_CITIES = [
  { name: "Mumbai",    state: "Maharashtra", count: 48, gradient: "linear-gradient(135deg,#6B1525 0%,#9B2038 100%)" },
  { name: "Delhi",     state: "Delhi",       count: 62, gradient: "linear-gradient(135deg,#78350F 0%,#B45309 100%)" },
  { name: "Bangalore", state: "Karnataka",   count: 37, gradient: "linear-gradient(135deg,#064E3B 0%,#065F46 100%)" },
  { name: "Jaipur",    state: "Rajasthan",   count: 41, gradient: "linear-gradient(135deg,#4C1D95 0%,#6D28D9 100%)" },
  { name: "Hyderabad", state: "Telangana",   count: 29, gradient: "linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 100%)" },
  { name: "Goa",       state: "Goa",         count: 22, gradient: "linear-gradient(135deg,#134E4A 0%,#0F766E 100%)" },
  { name: "Chennai",   state: "Tamil Nadu",  count: 31, gradient: "linear-gradient(135deg,#831843 0%,#BE185D 100%)" },
  { name: "Kolkata",   state: "West Bengal", count: 26, gradient: "linear-gradient(135deg,#1C1917 0%,#44403C 100%)" },
] as const;

export const TESTIMONIALS = [
  {
    id: "1",
    name: "Priya & Arjun Sharma",
    city: "Mumbai",
    hallName: "Royal Grand Banquet",
    rating: 5,
    text: "Hallnect made finding our dream venue effortless. We compared 12 halls in a single afternoon and booked within days. The verified listings gave us complete confidence.",
    weddingDate: "February 2024",
  },
  {
    id: "2",
    name: "Meera & Vikram Nair",
    city: "Bangalore",
    hallName: "Golden Horizon Hall",
    rating: 5,
    text: "As a couple planning from a different city, Hallnect was a lifesaver. Detailed photos, transparent pricing, and instant confirmation — exactly what we needed.",
    weddingDate: "November 2023",
  },
  {
    id: "3",
    name: "Sunita & Rahul Gupta",
    city: "Delhi",
    hallName: "The Leela Convention",
    rating: 5,
    text: "We were amazed by the range of venues available. The customer support team answered every question promptly. Our wedding was absolutely perfect.",
    weddingDate: "January 2024",
  },
] as const;

export const FAQ_ITEMS = [
  {
    q: "How does Hallnect work?",
    a: "Browse verified wedding halls across India, compare pricing and amenities, then request a booking directly through our platform. Once the owner confirms, you pay securely and receive instant confirmation.",
  },
  {
    q: "Are the listed venues verified?",
    a: "Yes. Every hall owner goes through our approval process before their listings go live. Our team reviews business credentials and on-site details to ensure quality.",
  },
  {
    q: "What is the platform fee?",
    a: "Hallnect charges a 5% platform fee on confirmed bookings. This covers secure payment processing, booking guarantees, and 24/7 customer support.",
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
    id: "starter",
    name: "Starter",
    tagline: "Get discovered",
    priceMonthly: 2999,
    durationLabel: "per month",
    features: [
      "Featured badge on your listing",
      "Priority search placement",
      "Up to 20 photos",
      "Basic analytics dashboard",
    ],
    isPopular: false,
    ctaLabel: "Get Started",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Grow bookings",
    priceMonthly: 5999,
    durationLabel: "per month",
    features: [
      "Everything in Starter",
      "Top-3 placement in city search",
      "Unlimited photos & video tour",
      "Advanced analytics & lead reports",
      "Priority customer support",
      "Promotional banner ads",
    ],
    isPopular: true,
    ctaLabel: "Start Pro Trial",
  },
  {
    id: "elite",
    name: "Elite",
    tagline: "Maximum visibility",
    priceMonthly: 9999,
    durationLabel: "per month",
    features: [
      "Everything in Pro",
      "#1 placement — homepage featured",
      "Dedicated account manager",
      "Custom listing page branding",
      "WhatsApp lead notifications",
      "Social media spotlight (monthly)",
    ],
    isPopular: false,
    ctaLabel: "Contact Sales",
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
    title: "Pan-India Coverage",
    description: "From metro cities to heritage towns, discover halls in 50+ cities across every state in India.",
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
