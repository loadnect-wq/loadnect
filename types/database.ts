// ─────────────────────────────────────────────────────────────────────────────
// Supabase database type placeholder.
//
// Replace this file with the auto-generated types from the Supabase CLI:
//   npx supabase gen types typescript --project-id <your-project-id> > types/database.ts
//
// Until then this placeholder keeps all Supabase client calls type-safe
// with a loose (empty) schema.
// ─────────────────────────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables:         Record<string, never>;
    Views:          Record<string, never>;
    Functions:      Record<string, never>;
    Enums:          Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
