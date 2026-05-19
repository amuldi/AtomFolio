import { fetchLiveMarketDataFromProviders } from '../../src/lib/liveMarketData.js';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const ticker = String(request.query?.ticker ?? '').trim();
    const name = String(request.query?.name ?? '').trim();

    if (!ticker && !name) {
      sendJson(response, 400, { error: 'Provide ticker or name.' });
      return;
    }

    const payload = await fetchLiveMarketDataFromProviders({ ticker, name });
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Market data fetch failed.',
    });
  }
}
