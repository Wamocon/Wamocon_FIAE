import { createClient } from '@supabase/supabase-js';

// Prefer an internal URL for server-side calls (inside Docker), fallback to public URL for browser.
const isServer = typeof window === 'undefined';
const supabaseUrl = (isServer ? process.env.SUPABASE_URL_INTERNAL : undefined) || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);