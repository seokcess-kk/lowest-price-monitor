import { collectAll } from '../src/scraper';

async function main(): Promise<void> {
  console.log('가격 수집 시작...');
  const result = await collectAll({ isManual: false });
  console.log(`수집 완료: ${result.success}건 성공, ${result.failed}건 실패`);
  if (result.errors.length > 0) {
    console.error('에러:', result.errors);
  }
  if (result.failed > 0 && result.success === 0) {
    process.exit(1);
  }
}

main();
