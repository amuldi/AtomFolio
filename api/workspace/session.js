import { handleWorkspaceSessionRequest } from '../../server/apiHandlers.mjs';
import { resolveWorkspaceSessionContext } from '../../server/workspaceAccess.mjs';
import { sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  await handleWorkspaceSessionRequest({
    method: request.method,
    workspaceSession: resolveWorkspaceSessionContext(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
