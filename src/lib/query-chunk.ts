/**
 * 활성 상품이 많아지면(현재 600+개) `.in('product_id', [...전체...])` 형태의 쿼리가
 * PostgREST의 URL 길이 한도를 넘겨 400 Bad Request로 실패한다.
 *
 * 이 헬퍼는 ID 목록을 청크로 쪼개 병렬 조회하고, 각 청크는 `range`로 페이지네이션해
 * 기본 행 상한(Supabase max-rows)도 넘기지 않도록 결과를 합친다.
 *
 * build(chunk, from, to)는 supabase 쿼리 빌더(.in(col, chunk) ... .range(from, to))를
 * 그대로 반환하면 된다. 빌더는 thenable이라 await 시 { data, error }로 풀린다.
 *
 * 청크는 product 단위로 분할되므로, 정렬은 "청크 내"에서만 보장된다.
 * (한 product의 row는 한 청크에만 속하므로, product 단위 latest/groupBy 용도엔 안전)
 */
const DEFAULT_CHUNK_SIZE = 100;
const PAGE_SIZE = 1000;

export async function selectByIdChunks<T>(
  ids: string[],
  build: (
    chunk: string[],
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<T[]> {
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }

  const perChunk = await Promise.all(
    chunks.map(async (chunk) => {
      const acc: T[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await build(chunk, from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        acc.push(...(data as T[]));
        if (data.length < PAGE_SIZE) break;
      }
      return acc;
    })
  );

  return perChunk.flat();
}
