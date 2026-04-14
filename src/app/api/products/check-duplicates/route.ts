import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface CheckItem {
  rowIndex: number;
  name: string;
  coupang_url?: string | null;
  naver_url?: string | null;
  danawa_url?: string | null;
}

interface CheckBody {
  items: CheckItem[];
}

type DuplicateKind = 'urlMatch' | 'nameSimilar';

interface CheckResult {
  rowIndex: number;
  status: 'new' | 'duplicate' | 'similar';
  duplicates: Array<{
    kind: DuplicateKind;
    productId: string;
    productName: string;
    matchedField?: 'coupang_url' | 'naver_url' | 'danawa_url';
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
 * CSV 일괄 등록 미리보기용 중복 확인.
 *
 * 판정 우선순위:
 *  1. 채널 URL이 정확히 일치 → status: 'duplicate' (등록 차단 권장)
 *  2. 정규화된 상품명이 일치 → status: 'similar' (경고만, 등록은 허용)
 *  3. 그 외 → status: 'new'
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
      .select('id, name, coupang_url, naver_url, danawa_url');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // URL → product 인덱스 (빠른 lookup)
    const urlIndex = new Map<
      string,
      { id: string; name: string; field: 'coupang_url' | 'naver_url' | 'danawa_url' }
    >();
    const nameIndex = new Map<string, { id: string; name: string }>();

    for (const p of existing ?? []) {
      if (p.coupang_url) {
        urlIndex.set(p.coupang_url as string, {
          id: p.id as string,
          name: p.name as string,
          field: 'coupang_url',
        });
      }
      if (p.naver_url) {
        urlIndex.set(p.naver_url as string, {
          id: p.id as string,
          name: p.name as string,
          field: 'naver_url',
        });
      }
      if (p.danawa_url) {
        urlIndex.set(p.danawa_url as string, {
          id: p.id as string,
          name: p.name as string,
          field: 'danawa_url',
        });
      }
      nameIndex.set(normalize(p.name as string), {
        id: p.id as string,
        name: p.name as string,
      });
    }

    const results: CheckResult[] = body.items.map((item) => {
      const duplicates: CheckResult['duplicates'] = [];

      for (const field of ['coupang_url', 'naver_url', 'danawa_url'] as const) {
        const url = item[field];
        if (!url) continue;
        const hit = urlIndex.get(url);
        if (hit) {
          duplicates.push({
            kind: 'urlMatch',
            productId: hit.id,
            productName: hit.name,
            matchedField: hit.field,
          });
        }
      }

      // URL 매치가 없을 때만 이름 유사도 검사
      if (duplicates.length === 0 && item.name) {
        const normName = normalize(item.name);
        if (normName) {
          const hit = nameIndex.get(normName);
          if (hit) {
            duplicates.push({
              kind: 'nameSimilar',
              productId: hit.id,
              productName: hit.name,
            });
          }
        }
      }

      const status: CheckResult['status'] =
        duplicates.some((d) => d.kind === 'urlMatch')
          ? 'duplicate'
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
