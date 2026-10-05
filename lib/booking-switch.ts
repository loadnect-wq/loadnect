// The one switch for online booking. Its own module, with no imports, so the
// validation schemas and lib/booking-mode.ts can both read it without an
// import cycle. See lib/booking-mode.ts for what switching it means.
export const DIRECT_BOOKING_ENABLED = false;
