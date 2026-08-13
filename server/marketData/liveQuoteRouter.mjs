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
//
// A bare ticker isn't the only way a domestic lookup arrives, though — a lot of real CSV imports
// (see README's CSV-inference section) carry only a Korean company name (종목명), no ticker at
// all. Without resolving that to a KRX code first, those lookups skipped KIS entirely and always
// went straight to the unofficial Naver/Mirae/Yahoo chain, even though KIS is the one source here
// backed by an actual API contract. resolveDomesticSymbolFromName closes that gap using only the
// offline local alias table (searchLocalSymbolSuggestions — no network call, no cost, no latency)
// so name-only domestic lookups get the same KIS-first treatment a bare ticker already had.
import { fetchLiveMarketDataFromProviders, searchLocalSymbolSuggestions } from '../../src/lib/liveMarketData.js';
import { isKisConfigured, fetchKisDomesticQuote } from './kisProvider.mjs';
import { recordOperationalEvent } from '../operationalEvents.mjs';

const DOMESTIC_SYMBOL_PATTERN = /^\d{6}(?:\.(?:KS|KQ))?$/;

function resolveDomesticSymbolFromName(name) {
  const query = String(name ?? '').trim();

  if (!query) {
    return '';
  }

  const [bestMatch] = searchLocalSymbolSuggestions(query, 1);
  const symbol = String(bestMatch?.symbol ?? '').trim().toUpperCase();

  return DOMESTIC_SYMBOL_PATTERN.test(symbol) ? symbol : '';
}

// Every provider failure in the chain below — including KIS's own — lands here instead of
// vanishing into a swallowed catch block. It's deliberately just a counter feeding
// /api/health's existing operationalEvents.countsByCode, not a new dashboard: the goal is "which
// upstream is actually flaky, and how often" becoming answerable from data already exposed,
// without standing up any new infra.
function reportProviderFailure(provider, symbol, error) {
  recordOperationalEvent({
    level: 'warn',
    area: 'market-data-provider',
    code: `provider-fail:${provider}`,
    message: error instanceof Error ? error.message : String(error ?? ''),
    metadata: { provider, symbol: String(symbol ?? '') },
  });
}

export async function fetchLiveQuoteWithKisRouting({ ticker, name, signal } = {}) {
  // A bare ticker is tried as-is (fetchKisDomesticQuote itself rejects non-domestic shapes
  // without a network call); with no ticker, fall back to resolving one from the name via the
  // offline alias table so a name-only domestic lookup still gets a shot at KIS.
  const kisSymbol = ticker || resolveDomesticSymbolFromName(name);

  if (isKisConfigured() && kisSymbol) {
    try {
      const quote = await fetchKisDomesticQuote(kisSymbol, { signal });

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
    } catch (error) {
      // Silent fallthrough by design — network error, expired/unreachable token, or simply not a
      // KIS-domestic symbol (kis-symbol-not-domestic) all land here the same way the existing
      // chain already treats a failed Naver/Yahoo attempt: try the next provider, don't surface a
      // partial failure to the caller as long as something further down the chain can still answer.
      // Still worth counting, though — see reportProviderFailure above.
      reportProviderFailure('kis', kisSymbol, error);
    }
  }

  return fetchLiveMarketDataFromProviders({
    ticker,
    name,
    signal,
    onProviderError: ({ provider, symbol, error }) => reportProviderFailure(provider, symbol, error),
  });
}
