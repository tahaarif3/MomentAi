/**
 * Returns the authenticated Supabase user ID from the Authorization header.
 * Verifies the JWT via Supabase Admin client.
 * Returns null if no valid session is found.
 */
import { supabaseAdmin } from '../config/supabase.js';

export async function getAuthUserId(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return null;
  }

  // In test mode: x-test-user-id header takes precedence over test_token
  if (process.env.NODE_ENV === 'test') {
    const testUserHeader = req.headers['x-test-user-id'];
    if (testUserHeader && typeof testUserHeader === 'string') {
      return testUserHeader;
    }
    if (token === 'test_token') {
      return 'test_user_id';
    }
  }

  if (!supabaseAdmin) {
    console.warn('Supabase Admin client not configured, cannot verify JWT.');
    return null;
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return null;
    }
    return user.id;
  } catch (err) {
    console.error('Error verifying Supabase JWT:', err);
    return null;
  }
}

/**
 * Get full Supabase user object from JWT.
 * Returns the user metadata including email, name, avatar, and provider.
 */
export async function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return null;
  }

  if (process.env.NODE_ENV === 'test' && token === 'test_token') {
    return {
      id: 'test_user_id',
      email: 'test@example.com',
      user_metadata: {
        full_name: 'Test User',
        avatar_url: null
      },
      app_metadata: {
        provider: 'google'
      }
    };
  }

  if (!supabaseAdmin) {
    return null;
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return null;
    }
    return user;
  } catch (err) {
    console.error('Error fetching Supabase user:', err);
    return null;
  }
}
