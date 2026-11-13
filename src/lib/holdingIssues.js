// Flags holdings whose entered numbers are probably wrong, so they don't silently distort the
// portfolio total. Real example: QQQI saved with QQQ's buy price (690.38 vs a ~51.6 quote) turned
// a roughly flat portfolio into "-31%" with nothing on screen saying why.
//
// Works on a resolved position (resolveHoldingPosition), so currencies are already reconciled.
// Returns a list of { code, label } — empty when nothing looks off.

// Losses: a buy price 5x the current price (-80%) is rare and is exactly the "copied another
// security's price" mistake. Gains: long-held winners really do reach 5-8x (SK하이닉스 +577% in
// the sample data), so only 10x and beyond is treated as suspicious.
const LOSS_RATIO_LIMIT = 5;
const GAIN_RATIO_LIMIT = 10;
const RETURN_LIMIT = 1000; // |return| above 1000% when prices themselves aren't available

function formatRatio(ratio) {
  return ratio >= 10 ? Math.round(ratio).toString() : ratio.toFixed(1).replace(/\.0$/, '');
}

export function detectHoldingIssues(position, { language = 'ko' } = {}) {
  const issues = [];
  const en = language === 'en';
  if (!position) {
    return issues;
  }

  const shares = Number(position.shares);
  if (!(Number.isFinite(shares) && shares > 0)) {
    issues.push({ code: 'no-shares', label: en ? 'No quantity' : '수량 없음' });
  }

  const buy = Number(position.buyPriceInNativeCurrency ?? position.buyPrice);
  const current = Number(position.currentPrice);
  if (Number.isFinite(buy) && buy > 0 && Number.isFinite(current) && current > 0) {
    const isLoss = buy > current;
    const ratio = isLoss ? buy / current : current / buy;
    if (ratio > (isLoss ? LOSS_RATIO_LIMIT : GAIN_RATIO_LIMIT)) {
      issues.push({
        code: 'price-ratio',
        label: en
          ? `Buy price ${formatRatio(ratio)}x off current`
          : `매수가가 현재가와 ${formatRatio(ratio)}배 차이`,
      });
    }
  }

  const returnRate = Number(position.returnRate);
  if (Number.isFinite(returnRate) && Math.abs(returnRate) > RETURN_LIMIT && !issues.some((i) => i.code === 'price-ratio')) {
    issues.push({
      code: 'extreme-return',
      label: en ? `Return ${Math.round(returnRate)}%` : `수익률 ${Math.round(returnRate)}%`,
    });
  }

  return issues;
}
