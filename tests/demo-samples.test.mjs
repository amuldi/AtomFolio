import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { parsePortfolioTextDetailed } from '../src/lib/portfolioIngestionCore.js';
import { detectHoldingIssues, suggestHoldingFix } from '../src/lib/holdingIssues.js';
import {
  readRecordedReturnRate,
  resolveHoldingPosition,
} from '../src/lib/portfolioAnalyticsSummary.js';
import { buildFxRates } from '../src/utils/currency.js';

const demoDir = new URL('../samples/demo/', import.meta.url);
const ERROR_PRACTICE_FILE = '입력 오류 예시.csv';

// The demo CSVs are what a live presentation loads; a holding without quantity or buy price
// would show the amber "check this" ring on stage.
test('demo portfolios parse cleanly with ticker, buy price, quantity and currency on every row', async () => {
  const files = (await readdir(demoDir)).filter((name) => name.endsWith('.csv') && name !== ERROR_PRACTICE_FILE);
  assert.equal(files.length, 8);

  for (const file of files) {
    const text = await readFile(new URL(file, demoDir), 'utf8');
    const result = parsePortfolioTextDetailed(text);
    assert.equal(result.diagnostics.reviewStatus, 'ok', file);
    const holdings = (text.trim().split('\n').length - 1) / 6;
    assert.ok(holdings >= 10, `${file}: ${holdings} holdings`);

    const roles = result.diagnostics.fieldRoles.roles;
    for (const role of ['snapshotDate', 'securityName', 'securityCode', 'marketValue', 'currency']) {
      assert.ok(roles[role], `${file}: ${role}`);
    }

    for (const line of text.trim().split('\n').slice(1)) {
      const cells = line.split(',');
      const buyPrice = Number(cells.at(-5));
      const shares = Number(cells.at(-4));
      assert.ok(buyPrice > 0 && shares > 0, `${file}: ${line}`);
    }
  }
});

// The practice file exists to show the one-click fix: each broken row must be flagged and fixable.
test('the input-error practice file has three flagged holdings, each with a one-click fix', async () => {
  const text = await readFile(new URL(ERROR_PRACTICE_FILE, demoDir), 'utf8');
  const { items } = parsePortfolioTextDetailed(text);
  const fxRates = buildFxRates(1400);
  const flagged = items
    .map((item) => {
      const position = resolveHoldingPosition(item, { baseCurrency: 'KRW', fxRates });
      return {
        issues: detectHoldingIssues(position),
        fix: suggestHoldingFix(position, { recordedReturnRate: readRecordedReturnRate(item), usdKrwRate: 1400 }),
      };
    })
    .filter((entry) => entry.issues.length);

  assert.equal(flagged.length, 3);
  assert.ok(flagged.every((entry) => entry.fix));
});
