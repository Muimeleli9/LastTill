import { createClient } from '@supabase/supabase-js';

let client;
export function getClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes('your-project') || key === 'your-public-key') {
    throw new Error('Supabase is not configured. Copy .env.example to .env, add your project URL and public key, then restart the dev server.');
  }
  if (key.startsWith('sb_secret_')) throw new Error('A secret key must never be used in the frontend. Use a publishable key.');
  if (key.startsWith('ey')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') throw new Error('Remove the service-role key from frontend configuration immediately.');
    } catch (error) {
      if (error.message.includes('service-role')) throw error;
    }
  }
  client = createClient(url, key, {
    db: { retry: false, timeout: 15000 },
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false
    }
  });
  return client;
}
