import { handleMarketSearchRequest } from '../../server/apiHandlers.mjs';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleMarketSearchRequest({
    method: request.method,
    query: request.query,
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
