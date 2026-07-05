/**
 * Supabase Server Client Configuration
 * Used for JWT verification and admin operations.
 */
import { createClient } from '@supabase/supabase-js';

// Polyfill global WebSocket for Node.js environments < 22 to prevent Supabase Realtime errors
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {
    constructor() {
      throw new Error("WebSockets are not supported/needed on this server instance.");
    }
  };
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_ANON_KEY is missing. Supabase Auth will not function.');
}

/**
 * Admin client using the service role key.
 * Used for server-side operations like verifying JWTs and managing users.
 * NEVER expose this client or key to the frontend.
 */
export const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Public client using the anon key.
 * Used for operations that should respect Row Level Security (RLS).
 */
export const supabasePublic = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

export { supabaseUrl, supabaseAnonKey };
