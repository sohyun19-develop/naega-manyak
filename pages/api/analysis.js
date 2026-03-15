import { redis } from '../../lib/redis';
import { isMarketClosed, getTradingDate } from '../../lib/market';
import { generateAnalysis } from '../../lib/generate-analysis';

const STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '005380', name: '현대차' },
  { code: '035420', name: 'NAVER' },
  { code: '035720', name: '카카오' },
  { code: '373220', name: 'LG에너지솔루션' },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });

  const stock = STOCKS.find(s => s.code === code);
  if (!stock) return res.status(400).json({ error: '지원하지 않는 종목' });

  const date = getTradingDate();
  const cacheKey = `analysis:${code}:${date}`;

  try {
    // 1. 캐시 확인
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, source: 'cache' });
    }

    // 2. 캐시 미스 — 장 마감 후면 on-demand 생성
    if (isMarketClosed()) {
      // 중복 생성 방지 (간단한 락)
      const lockKey = `lock:${code}:${date}`;
      const locked = await redis.set(lockKey, '1', { nx: true, ex: 60 });

      if (!locked) {
        // 다른 요청이 생성 중 — 잠깐 대기 후 캐시 재확인
        await new Promise(r => setTimeout(r, 3000));
        const retry = await redis.get(cacheKey);
        if (retry) return res.status(200).json({ ...retry, source: 'cache' });
        return res.status(202).json({ status: 'generating', message: '분석을 생성하고 있어요. 잠시 후 다시 시도해주세요.' });
      }

      try {
        const analysis = await generateAnalysis(code, stock.name);
        await redis.set(cacheKey, analysis, { ex: 86400 }); // 24시간 TTL
        await redis.del(lockKey);
        return res.status(200).json({ ...analysis, source: 'generated' });
      } catch (e) {
        await redis.del(lockKey);
        return res.status(500).json({ error: e.message });
      }
    }

    // 3. 장중이면 아직 분석 없음
    return res.status(200).json({
      status: 'pending',
      message: '장 마감 후(15:30) 오늘의 분석이 생성돼요.',
      stock: { code, name: stock.name }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
