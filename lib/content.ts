// Static content used across public pages.
// Keep data here so components stay logic-only.
//
// TESTIMONIALS, FAQ_ITEMS, WHY_CHOOSE and OWNER_BENEFITS were removed. None was
// imported by anything, and each asserted something untrue: three invented
// couples with invented 2023/2024 weddings at halls that do not exist, a "24/7
// wedding concierge team", "thousands of couples search Hallnect every day",
// "instant confirmation ... locked in with a digital guarantee" (a booking is
// not confirmed until the venue accepts it), and an owner-cancellation promise
// to "find an alternative venue at no extra cost". Dead code is harmless right
// up to the moment somebody renders it, and fabricated reviews on a live
// marketplace are not a small mistake. The same reasoning retired PREMIUM_TIERS
// below.
//
// PREMIUM_TIERS was removed. It was a SECOND, hardcoded plan catalogue that
// disagreed with the real one in premium_plans: it named the Rs4,999 plan
// "Pro" (its actual name is Premium) and advertised an "Elite" plan at Rs9,999
// that does not exist - the Rs9,999 plan is Pro. It also sold an analytics
// dashboard and priority support, neither of which is built. Only the owner
// dashboard rendered it, and that now reads fetchPremiumPlans() + PLAN_FEATURES
// like every other plan surface, so there is one catalogue again.

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
