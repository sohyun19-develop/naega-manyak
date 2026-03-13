export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'code 파라미터 필요' });
  }

  try {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.naver.com',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });

    const html = await response.text();

    // 현재가 파싱
    const priceMatch = html.match(/id="_nowVal"[^>]*>([0-9,]+)</);
    const changeMatch = html.match(/id="_change"[^>]*>.*?([0-9,]+)</s);
    const signMatch = html.match(/class="([^"]*blind[^"]*)"[^>]*>(상승|하락|보합)</);

    if (!priceMatch) {
      return res.status(404).json({ error: '종가 파싱 실패' });
    }

    const price = parseInt(priceMatch[1].replace(/,/g, ''));
    const change = changeMatch ? parseInt(changeMatch[1].replace(/,/g, '')) : 0;
    const sign = signMatch ? signMatch[2] : '보합';
    const changePct = price > 0 ? ((change / (price - change)) * 100).toFixed(2) : '0.00';
    const isUp = sign === '상승';
    const isDown = sign === '하락';

    return res.status(200).json({
      price,
      change: isDown ? -change : change,
      changePct: isDown ? `-${changePct}` : isUp ? `+${changePct}` : '0.00',
      sign
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
