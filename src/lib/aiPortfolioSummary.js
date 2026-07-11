import { getPortfolioWorkspaceId } from '../utils/storage.js';

export async function fetchPortfolioAiSummary({
  portfolioId,
  portfolio,
  language = 'ko',
  refresh = false,
  save = true,
  signal,
} = {}) {
  const workspaceId = getPortfolioWorkspaceId();
  const response = await fetch('/api/ai/portfolio-summary', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-atomfolio-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      portfolioId,
      portfolio,
      language,
      refresh,
      save,
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `AI summary request failed with ${response.status}.`);
  }

  return payload;
}
