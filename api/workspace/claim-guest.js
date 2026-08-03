import { handleWorkspaceClaimGuestRequest } from '../../server/apiHandlers.mjs';
import { resolveAuthContext } from '../../server/workspaceAccess.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleWorkspaceClaimGuestRequest({
    method: request.method,
    authContext: await resolveAuthContext(request),
    readBody: () => readJsonBody(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
