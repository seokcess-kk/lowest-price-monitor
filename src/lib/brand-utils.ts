/**
 * 브랜드명 정규화·매칭 유틸.
 * 정확 일치는 normalize 후 비교, 유사 후보는 동일 결과(즉, 표기는 다르지만
 * 정규화 키가 같은 것)를 같은 브랜드로 본다. 한영 매핑은 다루지 않는다.
 */

/** 공백·기호 제거 + 소문자화 — DB의 brand.name과 사용자의 입력 표기 차이를 흡수 */
export function normalizeBrand(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s()[\]{}_\-,.·•/\\&'"]/g, '');
}

export interface BrandLite {
  id: string;
  name: string;
}

/**
 * 입력 brand 문자열에 대해 기존 brand 목록에서 매칭 결과를 돌려준다.
 * - exact: 정규화 후 동일한 기존 브랜드 (그대로 매핑)
 * - 없으면 신규로 처리
 */
export function matchBrand(
  input: string,
  existing: BrandLite[]
): { matched: BrandLite | null } {
  const key = normalizeBrand(input);
  if (!key) return { matched: null };
  for (const b of existing) {
    if (normalizeBrand(b.name) === key) return { matched: b };
  }
  return { matched: null };
}
