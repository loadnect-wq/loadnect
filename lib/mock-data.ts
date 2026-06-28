// Temporary mock data for hall listings UI.
// Replace with real Supabase queries once the database schema is created.

export type MockHall = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  capacity: number;
  pricePerDay: number;
  rating: number;
  reviewCount: number;
  amenities: string[];
  isPremium: boolean;
  isVerified: boolean;
  gradientIndex: number; // maps to CARD_GRADIENTS below
};

export const CARD_GRADIENTS = [
  "linear-gradient(135deg, #6B1525 0%, #9B2038 100%)",
  "linear-gradient(135deg, #78350F 0%, #B45309 100%)",
  "linear-gradient(135deg, #064E3B 0%, #065F46 100%)",
  "linear-gradient(135deg, #4C1D95 0%, #6D28D9 100%)",
  "linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 100%)",
  "linear-gradient(135deg, #831843 0%, #BE185D 100%)",
  "linear-gradient(135deg, #1C1917 0%, #44403C 100%)",
  "linear-gradient(135deg, #134E4A 0%, #0F766E 100%)",
  "linear-gradient(135deg, #7C2D12 0%, #C2410C 100%)",
];

export const MOCK_HALLS: MockHall[] = [];
// Intentionally empty. Real hall data comes from Supabase via lib/halls.ts
// (fetchHalls / fetchHallBySlug). No demo halls live in code.

// Tamil Nadu cities/areas only. Hallnect currently serves Tamil Nadu.
export const CITIES = [
  "Madurai", "Chennai", "Coimbatore", "Tiruchirappalli", "Salem",
  "Tirunelveli", "Thanjavur", "Dindigul", "Erode", "Tiruppur",
  "Vellore", "Kanchipuram", "Sivakasi", "Virudhunagar", "Karaikudi",
  "Rajapalayam", "Pollachi",
] as const;

export const CAPACITY_OPTIONS = [
  { label: "100+ guests",  value: "100"  },
  { label: "200+ guests",  value: "200"  },
  { label: "300+ guests",  value: "300"  },
  { label: "500+ guests",  value: "500"  },
  { label: "750+ guests",  value: "750"  },
  { label: "1000+ guests", value: "1000" },
] as const;

export function formatPrice(price: number): string {
  if (price >= 100000) return `₹${(price / 100000).toFixed(1)}L`;
  return `₹${price.toLocaleString("en-IN")}`;
}
