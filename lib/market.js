// KST 기준 장 마감 시간 유틸리티

function getKSTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

// 장 마감 여부 (15:30 이후 or 주말)
export function isMarketClosed() {
  const kst = getKSTDate();
  const day = kst.getDay(); // 0=일, 6=토
  if (day === 0 || day === 6) return true;
  const hour = kst.getHours();
  const min = kst.getMinutes();
  return (hour > 15) || (hour === 15 && min >= 30);
}

// 오늘의 거래일 날짜 (YYYY-MM-DD, KST)
export function getTradingDate() {
  const kst = getKSTDate();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
