// 서버사이드 주식 분석 생성 모듈
// 네이버 데이터 크롤링 → Gemini 분석 → 구조화된 결과 반환

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
  'Referer': 'https://m.stock.naver.com/',
  'Accept': 'application/json'
};

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: NAVER_HEADERS });
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

// 네이버에서 모든 데이터 수집
async function fetchStockData(code, name) {
  const [intData, newsData, kospiData, kosdaqData, kospiInt, marketPage, basicData] = await Promise.all([
    fetchJSON(`https://m.stock.naver.com/api/stock/${code}/integration`),
    fetchJSON(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=5`),
    fetchJSON('https://m.stock.naver.com/api/index/KOSPI/basic'),
    fetchJSON('https://m.stock.naver.com/api/index/KOSDAQ/basic'),
    fetchJSON('https://m.stock.naver.com/api/index/KOSPI/integration'),
    fetchText('https://finance.naver.com/marketindex/'),
    fetchJSON(`https://m.stock.naver.com/api/stock/${code}/basic`),
  ]);

  // 종목 가격
  let stock = { code, name, price: '--', change: '', up: false };
  if (basicData) {
    const price = parseInt(String(basicData.closePrice || '0').replace(/,/g, ''));
    const changeVal = parseFloat(String(basicData.compareToPreviousClosePrice || '0').replace(/,/g, ''));
    const changePct = parseFloat(String(basicData.fluctuationsRatio || '0').replace(/,/g, ''));
    stock.price = price.toLocaleString() + '원';
    stock.change = (changeVal >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
    stock.up = changeVal >= 0;
  }

  // 종합 정보
  let dataContext = '';
  if (intData) {
    const infos = {};
    (intData.totalInfos || []).forEach(i => { infos[i.code] = i.value; });
    dataContext += `\n[장중 데이터] 시가:${infos.openPrice} 고가:${infos.highPrice} 저가:${infos.lowPrice} 전일종가:${infos.lastClosePrice} 거래량:${infos.accumulatedTradingVolume} 시총:${infos.marketValue} 외인소진율:${infos.foreignRate} PER:${infos.per} PBR:${infos.pbr}`;
    const deals = (intData.dealTrendInfos || []).slice(0, 3);
    if (deals.length) {
      dataContext += '\n[종목 투자자별 매매 최근3일]';
      deals.forEach(d => {
        dataContext += `\n${d.bizdate}: 외국인${d.foreignerPureBuyQuant}주 기관${d.organPureBuyQuant}주 개인${d.individualPureBuyQuant}주`;
      });
    }
  }

  // 매크로
  let macro = {};
  if (kospiData) macro.kospi = `${kospiData.closePrice} (${kospiData.compareToPreviousClosePrice}, ${kospiData.fluctuationsRatio}%)`;
  if (kosdaqData) macro.kosdaq = `${kosdaqData.closePrice} (${kosdaqData.compareToPreviousClosePrice}, ${kosdaqData.fluctuationsRatio}%)`;
  if (kospiInt?.dealTrendInfo) {
    const d = kospiInt.dealTrendInfo;
    macro.marketDeal = `외국인${d.foreignValue}억 기관${d.institutionalValue}억 개인${d.personalValue}억`;
  }
  if (kospiInt?.upDownStockInfo) {
    const u = kospiInt.upDownStockInfo;
    macro.upDown = `상승${u.riseCount} 하락${u.fallCount} 보합${u.steadyCount}`;
  }
  if (marketPage) {
    const usd = marketPage.match(/class="head usd[\s\S]*?class="value">(.*?)</s);
    const wti = marketPage.match(/class="head wti[\s\S]*?class="value">(.*?)</s);
    if (usd) macro.usdkrw = usd[1];
    if (wti) macro.wti = wti[1];
  }
  dataContext += `\n[시장 매크로] 코스피:${macro.kospi || '?'} 코스닥:${macro.kosdaq || '?'} 원/달러:${macro.usdkrw || '?'}원 WTI유가:${macro.wti || '?'}달러`;
  if (macro.marketDeal) dataContext += ` 코스피수급:${macro.marketDeal}`;
  if (macro.upDown) dataContext += ` 코스피종목:${macro.upDown}`;

  // 뉴스
  if (newsData) {
    const allItems = Array.isArray(newsData)
      ? newsData.flatMap(group => group.items || [])
      : (newsData.items || []);
    const newsLines = allItems.slice(0, 5)
      .filter(item => item.title || item.titleFull)
      .map((item, i) => `${i + 1}. ${item.title || item.titleFull}: ${(item.body || '').slice(0, 200)}`)
      .join('\n');
    if (newsLines) dataContext += `\n[최근 뉴스]\n${newsLines}`;
  }

  return { stock, dataContext };
}

// Gemini API 호출
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Gemini API 오류');
  }

  const data = await response.json();
  let text = (data.candidates?.[0]?.content?.parts || [])
    .filter(p => p.text).map(p => p.text).join('');
  text = text.replace(/```xml\s*/g, '').replace(/```/g, '');
  return text;
}

// XML 파싱
function parseAnalysisXML(textContent) {
  const xmlStart = textContent.indexOf('<r>');
  const xmlEnd = textContent.indexOf('</r>') + 4;
  if (xmlStart === -1) throw new Error('분석 결과를 파싱할 수 없습니다');
  const xmlStr = textContent.slice(xmlStart, xmlEnd);

  const getTag = (tag) => {
    const m = xmlStr.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
    return m ? m[1].trim() : '';
  };
  const getAllTags = (tag) => {
    const re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'g');
    const results = []; let m;
    while ((m = re.exec(xmlStr)) !== null) results.push(m[1].trim());
    return results;
  };
  const factors = getAllTags('factor').map(f => {
    const fg = (t) => { const m = f.match(new RegExp('<' + t + '>([\\s\\S]*?)<\\/' + t + '>')); return m ? m[1].trim() : ''; };
    return { category: fg('category'), color: fg('color'), text: fg('text'), detail: fg('detail') };
  });

  return {
    summary: getTag('summary'),
    intraday: getTag('intraday'),
    factors,
    signals: {
      shortRisk: parseInt(getTag('shortRisk')) || 50,
      momentum: parseInt(getTag('momentum')) || 50,
      fundamental: parseInt(getTag('fundamental')) || 50
    },
    levelSimple: getTag('levelSimple')
  };
}

// 메인: 종목 분석 생성
export async function generateAnalysis(code, name) {
  const { stock, dataContext } = await fetchStockData(code, name);

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
  const priceInfo = stock.price !== '--'
    ? `오늘은 ${today}. ${name}(${code}) 종가 ${stock.price}, ${stock.change} (${stock.up ? '상승' : '하락'}).`
    : `오늘은 ${today}. ${name}(${code}) 주가 변동 분석.`;

  const prompt = `한국 주식 애널리스트. ${priceInfo}${dataContext}

위 실제 데이터를 기반으로 아래 XML만 반환. 일반론 금지, 데이터에서 확인된 수치+사건만.

<r>
<summary>핵심 한 문장</summary>
<intraday>시가→장중고저→종가 흐름</intraday>
<factors>
<factor><category>트리거</category><color>red</color><text>직접 원인 제목</text><detail>구체적 뉴스/이벤트 2문장</detail></factor>
<factor><category>매크로</category><color>yellow</color><text>글로벌 요인 제목</text><detail>미증시/유가/환율 수치 2문장</detail></factor>
<factor><category>수급</category><color>blue</color><text>매매 동향 제목</text><detail>오늘 외국인/기관 수치 2문장</detail></factor>
<factor><category>섹터 트렌드</category><color>green</color><text>업종 흐름 제목</text><detail>같은 섹터 동향 2문장</detail></factor>
</factors>
<shortRisk>0~100</shortRisk>
<momentum>0~100</momentum>
<fundamental>0~100</fundamental>
<levelSimple>주식 모르는 사람 위한 비유 2문장</levelSimple>
</r>`;

  const textContent = await callGemini(prompt);
  const analysis = parseAnalysisXML(textContent);

  return {
    ...analysis,
    stock: { code, name, price: stock.price, change: stock.change, up: stock.up },
    generatedAt: new Date().toISOString()
  };
}
