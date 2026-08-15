// ─── User roles ──────────────────────────────────────────────────────────────
export type UserRole = "customer" | "owner" | "admin";

// ─── Core user shape (populated after auth is wired up) ──────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: Date;
}

// ─── Hall / Venue ─────────────────────────────────────────────────────────────
export type HallStatus = "pending" | "approved" | "rejected" | "suspended";

export interface Hall {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  city: string;
  address: string;
  capacity: number;
  pricePerDay: number;
  images: string[];
  amenities: string[];
  status: HallStatus;
  isPremium: boolean;
  rating?: number;
  reviewCount?: number;
  createdAt: Date;
}

// ─── Booking ──────────────────────────────────────────────────────────────────
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "refunded";

export interface Booking {
  id: string;
  hallId: string;
  customerId: string;
  checkIn: Date;
  checkOut: Date;
  guestCount: number;
  totalPrice: number;
  platformFee: number;
  status: BookingStatus;
  notes?: string;
  createdAt: Date;
}

// ─── Review ───────────────────────────────────────────────────────────────────
export interface Review {
  id: string;
  hallId: string;
  authorId: string;
  rating: number; // 1–5
  comment: string;
  isVisible: boolean;
  createdAt: Date;
}

// ─── API response wrapper ─────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// ─── Pagination ───────────────────────────────────────────────────────────────
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}
