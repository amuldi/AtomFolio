import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { parsePortfolioTextDetailed } from '../src/lib/portfolioIngestionCore.js';

const demoDir = new URL('../samples/demo/', import.meta.url);

// The demo CSVs are what a live presentation loads; a holding without quantity or buy price
// would show the amber "check this" ring on stage.
test('demo portfolios parse cleanly with ticker, buy price, quantity and currency on every row', async () => {
  const files = (await readdir(demoDir)).filter((name) => name.endsWith('.csv'));
  assert.equal(files.length, 8);

  for (const file of files) {
    const text = await readFile(new URL(file, demoDir), 'utf8');
    const result = parsePortfolioTextDetailed(text);
    assert.equal(result.diagnostics.reviewStatus, 'ok', file);
    assert.ok(result.items.length >= 25, file);

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
