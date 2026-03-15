export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'code 파라미터 필요' });
  }

  try {
    // 네이버 증권 모바일 API
    const url = `https://m.stock.naver.com/api/stock/${code}/basic`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.stock.naver.com/',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    const price = parseInt(String(data.closePrice || data.stockPrice || '0').replace(/,/g, ''));
    const changeVal = parseFloat(String(data.compareToPreviousClosePrice || '0').replace(/,/g, ''));
    const changePct = parseFloat(String(data.fluctuationsRatio || '0').replace(/,/g, ''));
    const isUp = changeVal >= 0;

    return res.status(200).json({
      price,
      change: changeVal,
      changePct: (isUp ? '+' : '') + changePct.toFixed(2),
      name: data.stockName || ''
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
