import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'GITHUB_TOKEN이 설정되지 않았습니다.' }, { status: 500 });
    }

    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) {
      return NextResponse.json({ error: 'GITHUB_REPOSITORY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const workflowFile = process.env.GITHUB_WORKFLOW_FILE || 'collect-prices.yml';

    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `GitHub API 호출 실패: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ message: '수집이 트리거되었습니다.' });
  } catch (err) {
    return NextResponse.json({ error: '수집 트리거 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
