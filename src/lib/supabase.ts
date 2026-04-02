import { createClient as supabaseCreateClient } from '@supabase/supabase-js';

/**
 * 브라우저용 Supabase 클라이언트
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 사용
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return supabaseCreateClient(supabaseUrl, supabaseAnonKey);
}

/**
 * 서버 전용 Supabase 클라이언트
 * SUPABASE_SERVICE_ROLE_KEY 사용 — API 라우트, 스크래퍼용
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return supabaseCreateClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
