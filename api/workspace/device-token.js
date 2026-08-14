import { handleWorkspaceDeviceTokenRequest } from '../../server/apiHandlers.mjs';
import { resolveAuthContext } from '../../server/workspaceAccess.mjs';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleWorkspaceDeviceTokenRequest({
    method: request.method,
    authContext: await resolveAuthContext(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
