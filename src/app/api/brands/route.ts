import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { normalizeBrand } from '@/lib/brand-utils';
import type { Brand } from '@/types/database';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data as Brand[]);
  } catch (err) {
    console.error('[api/brands GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * 브랜드 생성 — name 기준 upsert.
 * 정규화 키가 같은 기존 브랜드가 있으면 그것을 그대로 반환 (표기 변경 없음).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: '브랜드명은 필수입니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: existing } = await supabase.from('brands').select('id, name');
    const key = normalizeBrand(name);
    const hit = (existing ?? []).find((b) => normalizeBrand(b.name as string) === key);
    if (hit) {
      return NextResponse.json(hit as Brand, { status: 200 });
    }

    const { data, error } = await supabase
      .from('brands')
      .insert({ name })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data as Brand, { status: 201 });
  } catch (err) {
    console.error('[api/brands POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
