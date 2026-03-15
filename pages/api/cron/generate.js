import { redis } from '../../../lib/redis';
import { getTradingDate } from '../../../lib/market';
import { generateAnalysis } from '../../../lib/generate-analysis';

const STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '005380', name: '현대자동차' },
  { code: '035420', name: 'NAVER' },
  { code: '035720', name: '카카오' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '068270', name: '셀트리온' },
  { code: '105560', name: 'KB금융' },
  { code: '005490', name: '포스코홀딩스' },
];

export default async function handler(req, res) {
  // Vercel Cron 인증 (배포 환경에서만)
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = getTradingDate();
  const results = [];

  // 6개 종목 병렬 생성
  const tasks = STOCKS.map(async (stock) => {
    const cacheKey = `analysis:${stock.code}:${date}`;
    try {
      // 이미 있으면 스킵
      const existing = await redis.get(cacheKey);
      if (existing) {
        results.push({ code: stock.code, name: stock.name, status: 'skipped (cached)' });
        return;
      }

      const analysis = await generateAnalysis(stock.code, stock.name);
      await redis.set(cacheKey, analysis, { ex: 86400 });
      results.push({ code: stock.code, name: stock.name, status: 'success' });
    } catch (e) {
      results.push({ code: stock.code, name: stock.name, status: 'error', error: e.message });
    }
  });

  await Promise.allSettled(tasks);

  return res.status(200).json({
    date,
    generatedAt: new Date().toISOString(),
    results
  });
}
