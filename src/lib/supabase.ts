import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://yllwvnrrlmjnoktbvdlt.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_enqPHhcNJiexcMhAVL1rJA_5YJfbgHc';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
