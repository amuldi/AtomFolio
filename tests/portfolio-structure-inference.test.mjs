import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parsePortfolioTextDetailed } from '../src/lib/portfolioIngestionCore.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/portfolio-structure-snapshots.json', import.meta.url), 'utf8'),
);

function summarizeDiagnostics(diagnostics) {
  return {
    delimiter: diagnostics.delimiter,
    hasDetectedHeader: diagnostics.hasDetectedHeader,
    skippedPreambleRowCount: diagnostics.skippedPreambleRowCount,
    rowCount: diagnostics.rowCount,
    bodyRowCount: diagnostics.bodyRowCount,
    parsedItemCount: diagnostics.parsedItemCount,
    reviewStatus: diagnostics.reviewStatus,
    headerLabels: diagnostics.headerLabels,
    mappedColumns: diagnostics.mappedColumns,
    fieldRoleNames: Object.keys(diagnostics.fieldRoles.roles).sort(),
    warningCodes: (diagnostics.warnings ?? []).map((warning) => warning.code).sort(),
  };
}

for (const [filePath, expectedSnapshot] of Object.entries(fixtures)) {
  test(`CSV structure inference matches snapshot: ${filePath}`, async () => {
    const text = await readFile(filePath, 'utf8');
    const result = parsePortfolioTextDetailed(text);

    assert.deepEqual(summarizeDiagnostics(result.diagnostics), expectedSnapshot);
  });
}
