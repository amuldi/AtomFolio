import { handleGuruProfileRequest } from '../../server/apiHandlers.mjs';
import { resolveClientKey } from '../../server/rateLimit.mjs';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleGuruProfileRequest({
    method: request.method,
    clientKey: resolveClientKey(request),
    query: request.query,
    sendJson: (status, payload, headers) => sendJson(response, status, payload, headers),
  });
}
