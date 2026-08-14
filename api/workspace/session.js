import {
  handleWorkspaceDeviceTokenRequest,
  handleWorkspaceSessionRequest,
} from '../../server/apiHandlers.mjs';
import {
  resolveAuthContext,
  resolveWorkspaceSessionContext,
} from '../../server/workspaceAccess.mjs';
import { sendJson } from '../_utils/http.js';

// Vercel's Hobby plan caps a deployment at 12 serverless functions — this repo is already at that
// ceiling, so /api/workspace/device-token is rewritten to this same file (see vercel.json) rather
// than getting its own. Vercel rewrites preserve the original request URL in `request.url`, which
// is what makes routing by pathname here work the same way separate files would.
export default async function handler(request, response) {
  const pathname = String(request.url ?? '').split('?')[0];

  if (pathname.endsWith('/device-token')) {
    await handleWorkspaceDeviceTokenRequest({
      method: request.method,
      authContext: await resolveAuthContext(request),
      sendJson: (status, payload) => sendJson(response, status, payload),
    });
    return;
  }

  await handleWorkspaceSessionRequest({
    method: request.method,
    workspaceSession: await resolveWorkspaceSessionContext(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
