import { handleAiPortfolioSummaryRequest } from '../../server/apiHandlers.mjs';
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

  await handleAiPortfolioSummaryRequest({
    method: request.method,
    workspaceId: workspaceContext.workspaceId,
    readBody: () => readJsonBody(request),
    sendJson: (status, payload) => sendJson(response, status, payload),
  });
}
