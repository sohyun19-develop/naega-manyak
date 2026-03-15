const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
  'Referer': 'https://m.stock.naver.com/',
  'Accept': 'application/json'
};

async function fetchJSON(url, headers = HEADERS) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code, name } = req.query;
  if (!code || !name) {
    return res.status(400).json({ error: 'code, name 파라미터 필요' });
  }

  // 모든 API 병렬 호출
  const [intData, newsData, kospiData, kosdaqData, kospiInt, marketPage] = await Promise.all([
    // 1. 종목 종합 (시가/고가/저가/수급)
    fetchJSON(`https://m.stock.naver.com/api/stock/${code}/integration`),
    // 2. 종목 뉴스
    fetchJSON(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=5`),
    // 3. 코스피
    fetchJSON('https://m.stock.naver.com/api/index/KOSPI/basic'),
    // 4. 코스닥
    fetchJSON('https://m.stock.naver.com/api/index/KOSDAQ/basic'),
    // 5. 코스피 종합 (시장 수급)
    fetchJSON('https://m.stock.naver.com/api/index/KOSPI/integration'),
    // 6. 환율/유가 (네이버 금융 시장지표)
    fetchText('https://finance.naver.com/marketindex/'),
  ]);

  // 종목 종합 정보 파싱
  let integration = null;
  if (intData) {
    const infos = {};
    (intData.totalInfos || []).forEach(i => { infos[i.code] = i.value; });
    const deals = (intData.dealTrendInfos || []).slice(0, 3).map(d => ({
      date: d.bizdate,
      foreign: d.foreignerPureBuyQuant,
      organ: d.organPureBuyQuant,
      individual: d.individualPureBuyQuant,
      volume: d.accumulatedTradingVolume
    }));
    integration = {
      open: infos.openPrice, high: infos.highPrice, low: infos.lowPrice,
      prevClose: infos.lastClosePrice, volume: infos.accumulatedTradingVolume,
      marketCap: infos.marketValue, foreignRate: infos.foreignRate,
      per: infos.per, pbr: infos.pbr, deals
    };
  }

  // 뉴스 파싱 (배열의 배열 구조)
  let news = [];
  if (newsData) {
    const allItems = Array.isArray(newsData)
      ? newsData.flatMap(group => group.items || [])
      : (newsData.items || []);
    news = allItems.slice(0, 5).map(item => ({
      title: item.title || item.titleFull || '',
      body: (item.body || '').slice(0, 200),
      date: item.datetime || ''
    }));
  }

  // 매크로 데이터
  let macro = {};
  if (kospiData) {
    macro.kospi = `${kospiData.closePrice} (${kospiData.compareToPreviousClosePrice}, ${kospiData.fluctuationsRatio}%)`;
  }
  if (kosdaqData) {
    macro.kosdaq = `${kosdaqData.closePrice} (${kosdaqData.compareToPreviousClosePrice}, ${kosdaqData.fluctuationsRatio}%)`;
  }
  // 코스피 시장 수급
  if (kospiInt?.dealTrendInfo) {
    const d = kospiInt.dealTrendInfo;
    macro.marketDeal = `외국인${d.foreignValue}억 기관${d.institutionalValue}억 개인${d.personalValue}억`;
  }
  if (kospiInt?.upDownStockInfo) {
    const u = kospiInt.upDownStockInfo;
    macro.upDown = `상승${u.riseCount} 하락${u.fallCount} 보합${u.steadyCount}`;
  }
  // 환율/유가 파싱
  if (marketPage) {
    const usd = marketPage.match(/class="head usd[\s\S]*?class="value">(.*?)</s);
    const wti = marketPage.match(/class="head wti[\s\S]*?class="value">(.*?)</s);
    if (usd) macro.usdkrw = usd[1];
    if (wti) macro.wti = wti[1];
  }

  return res.status(200).json({ integration, news, macro });
}
