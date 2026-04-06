import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST() {
  try {
    const supabase = createServiceClient();

    // 이미 pending/running 상태인 요청이 있으면 중복 방지
    const { data: existing } = await supabase
      .from('collect_requests')
      .select('id, status')
      .in('status', ['pending', 'running'])
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { message: '이미 수집이 진행 중입니다.', status: existing[0].status },
        { status: 200 }
      );
    }

    // 수집 요청 생성
    const { error } = await supabase
      .from('collect_requests')
      .insert({ status: 'pending' });

    if (error) {
      return NextResponse.json(
        { error: `수집 요청 생성 실패: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: '수집 요청이 등록되었습니다. 로컬 수집기가 처리합니다.' });
  } catch {
    return NextResponse.json({ error: '수집 요청 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 수집 상태 조회 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('collect_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return NextResponse.json({ status: 'idle' });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: 'idle' });
  }
}
