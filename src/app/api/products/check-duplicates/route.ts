import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface CheckItem {
  rowIndex: number;
  name: string;
  sabangnet_code?: string | null;
  coupang_url?: string | null;
  naver_url?: string | null;
  danawa_url?: string | null;
  /** 수정 시 본인 id 제외용 */
  excludeId?: string | null;
}

interface CheckBody {
  items: CheckItem[];
}

type DuplicateKind = 'urlMatch' | 'nameSimilar' | 'sabangnetMatch';

interface CheckResult {
  rowIndex: number;
  status: 'new' | 'duplicate' | 'similar' | 'sabangnet_conflict';
  duplicates: Array<{
    kind: DuplicateKind;
    productId: string;
    productName: string;
    matchedField?: 'coupang_url' | 'naver_url' | 'danawa_url' | 'sabangnet_code';
  }>;
}

/** 상품명 정규화 — 공백·괄호·특수문자 제거, 소문자화 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s()[\]{}_\-,.·•/\\]/g, '')
    .replace(/\d+(g|kg|ml|l|개|입|봉|팩)/gi, '');
}

/**
 * CSV 일괄 등록 및 단일 폼 제출 전 중복 확인.
 *
 * 판정 우선순위:
 *  1. 채널 URL이 정확히 일치 → 'duplicate' (등록 차단 권장)
 *  2. 사방넷코드 정확히 일치 → 'sabangnet_conflict' (사용자 승인 필요)
 *  3. 정규화된 상품명이 일치 → 'similar' (경고만)
 *  4. 그 외 → 'new'
 */
export async function POST(request: NextRequest) {
  try {
    const body: CheckBody = await request.json();
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ error: 'items 배열이 필요합니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: existing, error } = await supabase
      .from('products')
      .select('id, name, sabangnet_code, coupang_url, naver_url, danawa_url');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const urlIndex = new Map<
      string,
      { id: string; name: string; field: 'coupang_url' | 'naver_url' | 'danawa_url' }
    >();
    const nameIndex = new Map<string, { id: string; name: string }>();
    const sabangnetIndex = new Map<string, { id: string; name: string }>();

    for (const p of existing ?? []) {
      const pid = p.id as string;
      const pname = p.name as string;
      if (p.coupang_url) {
        urlIndex.set(p.coupang_url as string, { id: pid, name: pname, field: 'coupang_url' });
      }
      if (p.naver_url) {
        urlIndex.set(p.naver_url as string, { id: pid, name: pname, field: 'naver_url' });
      }
      if (p.danawa_url) {
        urlIndex.set(p.danawa_url as string, { id: pid, name: pname, field: 'danawa_url' });
      }
      const code = (p.sabangnet_code as string | null)?.trim();
      if (code) {
        sabangnetIndex.set(code, { id: pid, name: pname });
      }
      nameIndex.set(normalize(pname), { id: pid, name: pname });
    }

    const results: CheckResult[] = body.items.map((item) => {
      const duplicates: CheckResult['duplicates'] = [];
      const excludeId = item.excludeId ?? null;

      for (const field of ['coupang_url', 'naver_url', 'danawa_url'] as const) {
        const url = item[field];
        if (!url) continue;
        const hit = urlIndex.get(url);
        if (hit && hit.id !== excludeId) {
          duplicates.push({
            kind: 'urlMatch',
            productId: hit.id,
            productName: hit.name,
            matchedField: hit.field,
          });
        }
      }

      const code = item.sabangnet_code?.trim();
      if (code) {
        const hit = sabangnetIndex.get(code);
        if (hit && hit.id !== excludeId) {
          duplicates.push({
            kind: 'sabangnetMatch',
            productId: hit.id,
            productName: hit.name,
            matchedField: 'sabangnet_code',
          });
        }
      }

      if (
        !duplicates.some((d) => d.kind === 'urlMatch' || d.kind === 'sabangnetMatch') &&
        item.name
      ) {
        const normName = normalize(item.name);
        if (normName) {
          const hit = nameIndex.get(normName);
          if (hit && hit.id !== excludeId) {
            duplicates.push({
              kind: 'nameSimilar',
              productId: hit.id,
              productName: hit.name,
            });
          }
        }
      }

      const status: CheckResult['status'] = duplicates.some((d) => d.kind === 'urlMatch')
        ? 'duplicate'
        : duplicates.some((d) => d.kind === 'sabangnetMatch')
          ? 'sabangnet_conflict'
          : duplicates.some((d) => d.kind === 'nameSimilar')
            ? 'similar'
            : 'new';

      return { rowIndex: item.rowIndex, status, duplicates };
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[api/products/check-duplicates]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
