// The one switch for online booking. Its own module, with no imports, so the
// validation schemas and lib/booking-mode.ts can both read it without an
// import cycle. See lib/booking-mode.ts for what switching it means.
//
// ON since 2026-10-07 (migration 0114): online booking with an advance is back,
// as each hall's own choice beside quotes. Turning it off again needs 0112's
// two constraints back as well, or a hall can stay in DIRECT_BOOKING while
// every screen reads it as taking quotes.
export const DIRECT_BOOKING_ENABLED = true;
