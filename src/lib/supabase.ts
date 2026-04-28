import { createClient as supabaseCreateClient } from '@supabase/supabase-js';

function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `[supabase] 환경변수 ${name}이(가) 비어 있습니다. ${hint} (.env.local 또는 배포 환경 secrets 점검)`
    );
  }
  return v;
}

/**
 * 브라우저용 Supabase 클라이언트
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 사용
 */
export function createClient() {
  const supabaseUrl = requireEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    'Supabase 프로젝트 URL이 필요합니다.'
  );
  const supabaseAnonKey = requireEnv(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    '브라우저 anon key가 필요합니다.'
  );
  return supabaseCreateClient(supabaseUrl, supabaseAnonKey);
}

/**
 * 서버 전용 Supabase 클라이언트
 * SUPABASE_SERVICE_ROLE_KEY 사용 — API 라우트, 스크래퍼용.
 * 클라이언트 번들 유출 방지를 위해 서버 코드에서만 호출할 것.
 */
export function createServiceClient() {
  const supabaseUrl = requireEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    'Supabase 프로젝트 URL이 필요합니다.'
  );
  const serviceRoleKey = requireEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    '서버 전용 service_role key가 필요합니다.'
  );
  return supabaseCreateClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
