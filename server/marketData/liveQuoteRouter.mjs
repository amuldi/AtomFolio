// Server-only composition layer between the shared client+server fallback chain
// (src/lib/liveMarketData.js's fetchLiveMarketDataFromProviders — Naver → Mirae Asset proxy →
// Yahoo → Stooq) and the KIS provider (server/marketData/kisProvider.mjs). Kept as a separate
// module rather than importing kisProvider.mjs straight into liveMarketData.js because that file
// is shared with the browser bundle (see fetchLiveMarketData's client-side fallback path there) —
// KIS's app key/secret and its process.env reads have no reason to ever ship to a client bundle,
// even inertly.
//
// Routing for Korean-listed tickers (6-digit code, optionally .KS/.KQ suffixed) is now
// KIS (only when KIS_APP_KEY/KIS_APP_SECRET are set) → the existing chain's own first stop
// (Naver, already tried before Yahoo) → ... same as before. Every other ticker shape is untouched
// — this only ever adds one extra, cheap, silently-skippable attempt in front of what was already
// there; it doesn't remove or reorder anything else.
import { fetchLiveMarketDataFromProviders } from '../../src/lib/liveMarketData.js';
import { isKisConfigured, fetchKisDomesticQuote } from './kisProvider.mjs';

export async function fetchLiveQuoteWithKisRouting({ ticker, name, signal } = {}) {
  if (isKisConfigured() && ticker) {
    try {
      const quote = await fetchKisDomesticQuote(ticker, { signal });

      return {
        ...quote,
        // name/displayName aren't part of KIS's quote response (see kisProvider.mjs's own
        // comment) — filled in from whatever the caller already knew about this ticker, same as
        // every other provider branch in fetchLiveMarketDataFromProviders does for its own
        // payload before returning.
        name: name || quote.symbol,
        displayName: name || quote.symbol,
        rawName: name || quote.symbol,
      };
    } catch {
      // Silent fallthrough by design — network error, expired/unreachable token, or simply not a
      // KIS-domestic symbol (kis-symbol-not-domestic) all land here the same way the existing
      // chain already treats a failed Naver/Yahoo attempt: try the next provider, don't surface a
      // partial failure to the caller as long as something further down the chain can still answer.
    }
  }

  return fetchLiveMarketDataFromProviders({ ticker, name, signal });
}
