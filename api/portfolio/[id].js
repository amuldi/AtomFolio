import {
  deletePortfolio,
  getPortfolio,
  resolveWorkspaceId,
  updatePortfolio,
} from '../../server/portfolioStore.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  const workspaceId = resolveWorkspaceId(request);
  const portfolioId = String(request.query?.id ?? '').trim();

  if (!portfolioId) {
    sendJson(response, 400, { error: 'Portfolio id is required.' });
    return;
  }

  try {
    if (request.method === 'GET') {
      const portfolio = await getPortfolio(workspaceId, portfolioId);
      if (!portfolio) {
        sendJson(response, 404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(response, 200, { workspaceId, portfolio });
      return;
    }

    if (request.method === 'PUT' || request.method === 'PATCH') {
      const body = await readJsonBody(request);
      const payload = await updatePortfolio(workspaceId, portfolioId, body);
      if (!payload) {
        sendJson(response, 404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(response, 200, payload);
      return;
    }

    if (request.method === 'DELETE') {
      const deleted = await deletePortfolio(workspaceId, portfolioId);
      if (!deleted) {
        sendJson(response, 404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(response, 200, { workspaceId, deleted: true, id: portfolioId });
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Portfolio API failed.',
    });
  }
}
