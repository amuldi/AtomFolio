import { searchMarketSymbolSuggestions } from '../../src/lib/liveMarketData.js';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const query = String(request.query?.query ?? request.query?.q ?? '').trim();
    const limit = Math.min(12, Math.max(1, Number(request.query?.limit ?? 10) || 10));

    if (query.length < 2 && !/[가-힣]/.test(query)) {
      sendJson(response, 200, { suggestions: [] });
      return;
    }

    const suggestions = await searchMarketSymbolSuggestions(query, { limit });
    sendJson(response, 200, { suggestions });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Market search failed.',
    });
  }
}
