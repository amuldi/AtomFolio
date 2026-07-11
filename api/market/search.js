import { handleMarketSearchRequest } from '../../server/apiHandlers.mjs';
import { resolveClientKey } from '../../server/rateLimit.mjs';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  const clientKey = resolveClientKey(request);

  await handleMarketSearchRequest({
    method: request.method,
    clientKey,
    query: request.query,
    sendJson: (status, payload, headers) => sendJson(response, status, payload, headers),
  });
}
