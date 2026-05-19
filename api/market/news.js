import { fetchMarketNewsFromProviders } from '../../src/lib/marketNews.js';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const query = String(request.query?.query ?? '').trim().slice(0, 80);
    const tickers = String(request.query?.tickers ?? '')
      .split(',')
      .map((ticker) => ticker.trim().slice(0, 18))
      .filter(Boolean)
      .slice(0, 5);
    const language = String(request.query?.language ?? 'ko') === 'en' ? 'en' : 'ko';
    const mode = String(request.query?.mode ?? 'today') === 'search' ? 'search' : 'today';
    const payload = await fetchMarketNewsFromProviders({ query, tickers, language, mode });

    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Market news fetch failed.',
    });
  }
}
