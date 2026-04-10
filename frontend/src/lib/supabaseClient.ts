/**
 * Supabase client factory.
 * - Server-side: uses SUPABASE_SERVICE_ROLE_KEY (bypasses Row-Level Security).
 * - Client-side: uses NEXT_PUBLIC_SUPABASE_ANON_KEY (respects RLS).
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Server-side admin client (service role).
 * Must only be used in Route Handlers / Server Components — never exposed to the browser.
 */
export function createServerClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Public client for browser / client components.
 */
export function createBrowserClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}
