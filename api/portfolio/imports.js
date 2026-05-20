import {
  listImportHistory,
  resolveWorkspaceId,
  saveImportHistory,
} from '../../server/portfolioStore.mjs';
import { readJsonBody, sendJson } from '../_utils/http.js';

export default async function handler(request, response) {
  const workspaceId = resolveWorkspaceId(request);

  try {
    if (request.method === 'GET') {
      sendJson(response, 200, await listImportHistory(workspaceId));
      return;
    }

    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      sendJson(response, 201, await saveImportHistory(workspaceId, body));
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Import history API failed.',
    });
  }
}
