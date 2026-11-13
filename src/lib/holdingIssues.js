// Flags holdings whose entered numbers are probably wrong, so they don't silently distort the
// portfolio total. Real example: QQQI saved with QQQ's buy price (690.38 vs a ~51.6 quote) turned
// a roughly flat portfolio into "-31%" with nothing on screen saying why.
//
// Works on a resolved position (resolveHoldingPosition), so currencies are already reconciled.
// Returns a list of { code, label } — empty when nothing looks off.

const PRICE_RATIO_LIMIT = 5; // buy price more than 5x off the current price (either direction)
const RETURN_LIMIT = 500; // |return| above 500%

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
    const ratio = buy > current ? buy / current : current / buy;
    if (ratio > PRICE_RATIO_LIMIT) {
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
