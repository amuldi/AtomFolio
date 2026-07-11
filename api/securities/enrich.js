import { handleSecurityEnrichRequest } from '../../server/apiHandlers.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleSecurityEnrichRequest({
    method: request.method,
    readBody: () => readJsonBody(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
