import { handleAiPortfolioSummaryRequest } from '../../server/apiHandlers.mjs';
import { resolveClientKey } from '../../server/rateLimit.mjs';
import {
  resolveWorkspaceRequestContext,
  sendWorkspaceAccessError,
} from '../../server/workspaceAccess.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  const workspaceContext = await resolveWorkspaceRequestContext(request, {
    requiredRole: 'editor',
  });

  if (!workspaceContext.ok) {
    sendWorkspaceAccessError(workspaceContext, (status, payload) => sendJson(response, status, payload));
    return;
  }

  const clientKey = resolveClientKey(request);

  await handleAiPortfolioSummaryRequest({
    method: request.method,
    clientKey,
    workspaceId: workspaceContext.workspaceId,
    readBody: () => readJsonBody(request),
    sendJson: (status, payload, headers) => sendJson(response, status, payload, headers),
  });
}
