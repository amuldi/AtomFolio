import { handleSecurityEnrichRequest } from '../../server/apiHandlers.mjs';
import { resolveClientKey } from '../../server/rateLimit.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  const clientKey = resolveClientKey(request);

  await handleSecurityEnrichRequest({
    method: request.method,
    clientKey,
    readBody: () => readJsonBody(request),
    sendJson: (status, payload, headers) => sendJson(response, status, payload, headers),
  });
}
