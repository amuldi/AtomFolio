import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DartNotConfiguredError, fetchKoreanProfile, findKoreanCompany, searchKoreanCompanies } from '../server/dartFilings.mjs';

test('Korean company search matches names, stock codes and partial names', () => {
  assert.equal(searchKoreanCompanies('삼성전자')[0].corpCode, '00126380');
  assert.equal(searchKoreanCompanies('005930')[0].name, '삼성전자');
  assert.ok(searchKoreanCompanies('카카오').some((company) => company.name === '카카오페이'));
  assert.equal(searchKoreanCompanies('').length, 0);
  assert.equal(findKoreanCompany('00126380').stockCode, '005930');
  assert.equal(findKoreanCompany('nope'), null);
});

test('without DART_API_KEY a profile lookup refuses instead of calling DART', async () => {
  const saved = process.env.DART_API_KEY;
  delete process.env.DART_API_KEY;
  try {
    await assert.rejects(fetchKoreanProfile('00126380'), DartNotConfiguredError);
  } finally {
    if (saved !== undefined) process.env.DART_API_KEY = saved;
  }
});
