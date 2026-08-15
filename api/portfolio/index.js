import {
  handlePortfolioCollectionRequest,
  handleWorkspaceVersionRequest,
} from '../../server/apiHandlers.mjs';
import {
  resolveWorkspaceRequestContext,
  sendWorkspaceAccessError,
} from '../../server/workspaceAccess.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

// A version check (see handleWorkspaceVersionRequest) is routed through a `?version=1` query
// param on this same GET route rather than its own path/file — this repo is already at Vercel
// Hobby's 12-serverless-function ceiling (see api/workspace/session.js for how device-token got
// merged for the same reason), but a sibling path wasn't an option here even with a vercel.json
// rewrite: api/portfolio/[id].js already dynamically matches anything under /api/portfolio/*, and
// Vercel resolves filesystem routes (including dynamic segments) before rewrites are ever
// considered — a rewrite for /api/portfolio/version would just lose to [id].js treating "version"
// as a portfolio id. A query param on the exact, unambiguous /api/portfolio route sidesteps that
// entirely. Parsed off request.url directly (not request.query) so this works identically whether
// it's actually running on Vercel or through the local dev server's plain Node http request.
export default async function handler(request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://internal');
  const isVersionCheck = requestUrl.searchParams.has('version');

  const workspaceContext = await resolveWorkspaceRequestContext(request, {
    // The version check is read-only same as a GET on the collection itself — 'viewer' either way.
    requiredRole: isVersionCheck || request.method === 'GET' ? 'viewer' : 'editor',
  });

  if (!workspaceContext.ok) {
    sendWorkspaceAccessError(workspaceContext, (status, payload) => sendJson(response, status, payload));
    return;
  }

  if (isVersionCheck) {
    await handleWorkspaceVersionRequest({
      method: request.method,
      workspaceId: workspaceContext.workspaceId,
      sendJson: (status, payload) => sendJson(response, status, payload),
    });
    return;
  }

  await handlePortfolioCollectionRequest({
    method: request.method,
    workspaceId: workspaceContext.workspaceId,
    readBody: () => readJsonBody(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
