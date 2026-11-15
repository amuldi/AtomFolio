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

// One-click repair for a flagged holding, or null when the right value can't be inferred safely.
//
// - Buy price far from the quote, with an ordinary recorded 수익률 (e.g. +3.3% next to a 690 buy
//   price and a 51.6 quote): the recorded return is trusted and the buy price rebuilt from it,
//   buy = current ÷ (1 + return/100), in the security's own currency.
// - Buy price off by roughly the USD/KRW rate: typed in the other currency; convert it.
// - Quantity missing but a market value is recorded: quantity = market value ÷ current price.
//
// `patch` lists standard field keys (see setHoldingField) and their new values.
export function suggestHoldingFix(position, { recordedReturnRate = null, usdKrwRate = null, language = 'ko' } = {}) {
  if (!position) {
    return null;
  }
  const en = language === 'en';
  const issues = detectHoldingIssues(position, { language });
  const current = Number(position.currentPrice);
  const nativeCurrency = position.nativeCurrency || 'KRW';
  const formatPrice = (value) =>
    `${Number(value).toLocaleString(en ? 'en-US' : 'ko-KR', {
      maximumFractionDigits: nativeCurrency === 'KRW' ? 0 : 2,
    })} ${nativeCurrency}`;

  if (issues.some((issue) => issue.code === 'price-ratio') && current > 0) {
    const recorded = recordedReturnRate === null || recordedReturnRate === '' ? NaN : Number(recordedReturnRate);
    // Only a return whose rebuilt buy price passes the same ratio check can be trusted (a -92%
    // recorded next to the bad price would just reproduce it).
    if (Number.isFinite(recorded) && recorded > -80 && recorded < 900) {
      const buy = current / (1 + recorded / 100);
      const rounded = nativeCurrency === 'KRW' ? Math.round(buy) : Math.round(buy * 100) / 100;
      return {
        code: 'price-ratio',
        patch: { buyPrice: rounded, purchaseCurrency: nativeCurrency },
        label: en
          ? `Recorded return is ${recorded}%, so the buy price should be about ${formatPrice(rounded)}.`
          : `기록된 수익률이 ${recorded}%라서, 매수가는 약 ${formatPrice(rounded)}이어야 맞아요.`,
        actionLabel: en ? `Set buy price to ${formatPrice(rounded)}` : `매수가를 ${formatPrice(rounded)}로 고치기`,
      };
    }

    const buyNative = Number(position.buyPriceInNativeCurrency ?? position.buyPrice);
    const rate = Number(usdKrwRate);
    if (buyNative > 0 && rate > 0) {
      const candidate = [buyNative / rate, buyNative * rate].find((value) => {
        const ratio = value / current;
        return ratio > 1 / 3 && ratio < 3;
      });
      if (candidate) {
        const rounded = nativeCurrency === 'KRW' ? Math.round(candidate) : Math.round(candidate * 100) / 100;
        return {
          code: 'price-ratio',
          patch: { buyPrice: rounded, purchaseCurrency: nativeCurrency },
          label: en
            ? 'The buy price looks like it was typed in the other currency (KRW vs USD).'
            : '매수가를 다른 통화(원화/달러)로 입력한 것 같아요.',
          actionLabel: en ? `Convert to ${formatPrice(rounded)}` : `${formatPrice(rounded)}로 바꾸기`,
        };
      }
    }
    return null;
  }

  if (issues.some((issue) => issue.code === 'no-shares')) {
    const marketValue = Number(position.nativeMarketValue);
    if (marketValue > 0 && current > 0) {
      const raw = marketValue / current;
      const shares = Math.abs(raw - Math.round(raw)) < 0.02 ? Math.round(raw) : Math.round(raw * 10000) / 10000;
      if (shares > 0) {
        return {
          code: 'no-shares',
          patch: { shares },
          label: en
            ? `Market value ÷ current price gives about ${shares} shares.`
            : `평가금액 ÷ 현재가로 계산하면 약 ${shares}주예요.`,
          actionLabel: en ? `Set quantity to ${shares}` : `수량을 ${shares}주로 채우기`,
        };
      }
    }
  }

  return null;
}
