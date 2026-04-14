import { NextResponse, type NextRequest } from 'next/server';

/**
 * 간단한 HTTP Basic Auth 게이트.
 *
 * 환경변수:
 *   DASHBOARD_USERNAME, DASHBOARD_PASSWORD — 둘 다 설정돼 있을 때만 활성화
 *
 * 둘 중 하나라도 비어 있으면 게이트를 우회 (로컬 개발 / 점진 롤아웃 편의).
 * 인증 성공 시 세션 토큰을 쿠키에 굽지 않고 매 요청마다 헤더로 재확인한다.
 */
export function middleware(req: NextRequest) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;

  // 환경 변수가 없으면 인증 비활성 (개발 편의)
  if (!username || !password) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization') ?? '';

  if (authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6).trim();
    try {
      const decoded = atob(base64);
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (user === username && pass === password) {
        return NextResponse.next();
      }
    } catch {
      /* fallthrough → 401 */
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Lowest Price Monitor"',
    },
  });
}

/**
 * 매처:
 * - Next.js 내부 정적 파일(_next, favicon 등)은 제외해야 Basic Auth 팝업이 재발생하지 않음
 * - 나머지 모든 경로(루트·/products/*·/api/*·/export 등)는 보호
 */
export const config = {
  matcher: ['/((?!_next/|favicon.ico|robots.txt|sitemap.xml|manifest.json).*)'],
};
