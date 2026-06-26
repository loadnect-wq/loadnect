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

export const MOCK_HALLS: MockHall[] = [
  {
    id: "1",
    slug: "royal-grand-banquet-mumbai",
    name: "Royal Grand Banquet",
    city: "Mumbai",
    state: "Maharashtra",
    capacity: 800,
    pricePerDay: 250000,
    rating: 4.9,
    reviewCount: 312,
    amenities: ["AC", "Valet Parking", "Catering", "Bridal Suite"],
    isPremium: true,
    isVerified: true,
    gradientIndex: 0,
  },
  {
    id: "2",
    slug: "the-leela-convention-delhi",
    name: "The Leela Convention",
    city: "Delhi",
    state: "Delhi",
    capacity: 1200,
    pricePerDay: 350000,
    rating: 4.8,
    reviewCount: 245,
    amenities: ["AC", "Free Parking", "Catering", "DJ", "Garden"],
    isPremium: true,
    isVerified: true,
    gradientIndex: 1,
  },
  {
    id: "3",
    slug: "maharaja-gardens-hyderabad",
    name: "Maharaja Gardens",
    city: "Hyderabad",
    state: "Telangana",
    capacity: 600,
    pricePerDay: 180000,
    rating: 4.7,
    reviewCount: 198,
    amenities: ["AC", "Parking", "Outdoor Garden", "Generator Backup"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 2,
  },
  {
    id: "4",
    slug: "golden-horizon-hall-bangalore",
    name: "Golden Horizon Hall",
    city: "Bangalore",
    state: "Karnataka",
    capacity: 400,
    pricePerDay: 120000,
    rating: 4.6,
    reviewCount: 153,
    amenities: ["AC", "Parking", "In-house Decor", "AV Setup"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 3,
  },
  {
    id: "5",
    slug: "heritage-palace-banquet-jaipur",
    name: "Heritage Palace Banquet",
    city: "Jaipur",
    state: "Rajasthan",
    capacity: 700,
    pricePerDay: 200000,
    rating: 4.9,
    reviewCount: 421,
    amenities: ["AC", "Valet Parking", "Catering", "Pool", "Bridal Suite"],
    isPremium: true,
    isVerified: true,
    gradientIndex: 4,
  },
  {
    id: "6",
    slug: "pearl-convention-centre-chennai",
    name: "Pearl Convention Centre",
    city: "Chennai",
    state: "Tamil Nadu",
    capacity: 350,
    pricePerDay: 85000,
    rating: 4.4,
    reviewCount: 89,
    amenities: ["AC", "Parking", "Catering", "Generator Backup"],
    isPremium: false,
    isVerified: false,
    gradientIndex: 5,
  },
  {
    id: "7",
    slug: "the-grand-maratha-pune",
    name: "The Grand Maratha",
    city: "Pune",
    state: "Maharashtra",
    capacity: 450,
    pricePerDay: 130000,
    rating: 4.5,
    reviewCount: 117,
    amenities: ["AC", "Free Parking", "DJ", "In-house Decor"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 6,
  },
  {
    id: "8",
    slug: "emerald-palace-banquet-kolkata",
    name: "Emerald Palace Banquet",
    city: "Kolkata",
    state: "West Bengal",
    capacity: 550,
    pricePerDay: 160000,
    rating: 4.7,
    reviewCount: 202,
    amenities: ["AC", "Parking", "Catering", "Garden", "Bridal Suite"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 7,
  },
  {
    id: "9",
    slug: "sapphire-hall-goa",
    name: "Sapphire Hall & Gardens",
    city: "Goa",
    state: "Goa",
    capacity: 300,
    pricePerDay: 140000,
    rating: 4.7,
    reviewCount: 178,
    amenities: ["AC", "Beach Access", "Catering", "Pool"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 8,
  },
  {
    id: "10",
    slug: "coconut-lagoon-kochi",
    name: "Coconut Lagoon Banquet",
    city: "Kochi",
    state: "Kerala",
    capacity: 250,
    pricePerDay: 70000,
    rating: 4.6,
    reviewCount: 134,
    amenities: ["AC", "Parking", "Catering", "Garden"],
    isPremium: false,
    isVerified: true,
    gradientIndex: 0,
  },
  {
    id: "11",
    slug: "regal-banquet-hall-mumbai",
    name: "Regal Banquet Hall",
    city: "Mumbai",
    state: "Maharashtra",
    capacity: 600,
    pricePerDay: 175000,
    rating: 4.8,
    reviewCount: 289,
    amenities: ["AC", "Valet Parking", "Catering", "DJ", "Bridal Suite"],
    isPremium: true,
    isVerified: true,
    gradientIndex: 1,
  },
  {
    id: "12",
    slug: "crystal-grand-ahmedabad",
    name: "Crystal Grand Banquet",
    city: "Ahmedabad",
    state: "Gujarat",
    capacity: 500,
    pricePerDay: 115000,
    rating: 4.5,
    reviewCount: 96,
    amenities: ["AC", "Free Parking", "In-house Decor", "Generator Backup"],
    isPremium: false,
    isVerified: false,
    gradientIndex: 2,
  },
];

export const CITIES = [
  "Chennai", "Coimbatore", "Madurai",
  "Bangalore", "Hyderabad", "Kochi",
  "Mumbai", "Delhi", "Jaipur", "Pune", "Kolkata",
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
