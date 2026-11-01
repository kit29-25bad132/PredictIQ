/**
 * Predict IQ - Supabase browser client.
 *
 * Public build-time configuration only:
 *   VITE_SUPABASE_URL       - project URL (public)
 *   VITE_SUPABASE_ANON_KEY  - publishable/anon key (public by design)
 *
 * The service-role key, database credentials and JWT signing secrets must
 * NEVER appear in a VITE_ variable. This module only ever reads the two
 * public values above, and it fails loudly (config error) instead of falling
 * back to mock authentication when they are missing.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export const SUPABASE_STORAGE_KEY = 'predictiq-auth';

/**
 * Read and validate the public Supabase configuration.
 * Returns null when either value is missing or malformed.
 * Injectable `env` keeps this function unit-testable outside a Vite build.
 */
export function readSupabaseConfig(
  env: Record<string, unknown> = ((import.meta as any).env ?? {}) as Record<string, unknown>
): SupabaseConfig | null {
  const rawUrl = env.VITE_SUPABASE_URL;
  const rawKey = env.VITE_SUPABASE_ANON_KEY;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const anonKey = typeof rawKey === 'string' ? rawKey.trim() : '';

  if (!url || !anonKey) return null;
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) return null;

  return { url: url.replace(/\/+$/, ''), anonKey };
}

export const SUPABASE_CONFIG_ERROR =
  'Authentication is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend environment.';

let cachedClient: SupabaseClient | null = null;
let cachedConfig: SupabaseConfig | null = null;
let configError: string | null = null;

/**
 * Create a client instance. Split out so tests can construct clients against
 * fake transports without touching global state.
 */
export function createSupabaseBrowserClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: SUPABASE_STORAGE_KEY,
    },
  });
}

/** Lazily create (and cache) the application-wide Supabase client. */
export function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  if (configError) return null;

  const config = readSupabaseConfig();
  if (!config) {
    configError = SUPABASE_CONFIG_ERROR;
    return null;
  }

  cachedConfig = config;
  cachedClient = createSupabaseBrowserClient(config);
  return cachedClient;
}

/** Configuration problem to surface in the UI, or null when configured. */
export function getSupabaseConfigError(): string | null {
  return configError;
}

/** The validated config (used to build OAuth redirect URLs). */
export function getSupabaseConfig(): SupabaseConfig | null {
  if (!cachedConfig) {
    const config = readSupabaseConfig();
    if (config) cachedConfig = config;
  }
  return cachedConfig;
}

/** Test-only: drop cached state so each test starts clean. */
export function resetSupabaseForTests(): void {
  cachedClient = null;
  cachedConfig = null;
  configError = null;
}
