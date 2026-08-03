import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// portfolioStore.mjs reads ATOMFOLIO_STORE_DRIVER / ATOMFOLIO_LOCAL_DATA_PATH once at
// module-load time, so each driver under test needs its own fresh module instance.
async function loadPortfolioStore(driver, dataPath) {
  const env = {
    ATOMFOLIO_STORE_DRIVER: process.env.ATOMFOLIO_STORE_DRIVER,
    ATOMFOLIO_LOCAL_DATA_PATH: process.env.ATOMFOLIO_LOCAL_DATA_PATH,
    NODE_ENV: process.env.NODE_ENV,
  };

  process.env.ATOMFOLIO_STORE_DRIVER = driver;
  process.env.NODE_ENV = 'test';
  if (dataPath) {
    process.env.ATOMFOLIO_LOCAL_DATA_PATH = dataPath;
  } else {
    delete process.env.ATOMFOLIO_LOCAL_DATA_PATH;
  }

  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mod = await import(`../server/portfolioStore.mjs?contract-${driver}-${cacheBust}`);

  for (const [key, value] of Object.entries(env)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return mod;
}

const tempDir = await mkdtemp(path.join(tmpdir(), 'atomfolio-store-contract-'));
const fileStore = await loadPortfolioStore('file', path.join(tempDir, 'store.json'));

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING;
const postgresStore = databaseUrl ? await loadPortfolioStore('postgres') : null;

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerContractSuite(label, store) {
  test(`${label}: creates, updates, lists, and deletes a portfolio`, async () => {
    const workspaceId = uniqueId('guest:contract');
    const portfolioId = uniqueId('portfolio');

    const created = await store.createPortfolio(workspaceId, {
      id: portfolioId,
      fileName: 'contract.csv',
      items: [{ label: '삼성전자', detail: '1%' }],
      timelineItems: [{ label: '삼성전자', detail: '1%' }],
    });
    assert.equal(created.portfolio.id, portfolioId);
    assert.equal(created.portfolio.items.length, 1);

    const fetched = await store.getPortfolio(workspaceId, portfolioId);
    assert.equal(fetched.fileName, 'contract.csv');

    const updated = await store.updatePortfolio(workspaceId, portfolioId, {
      fileName: 'contract-v2.csv',
      items: [{ label: '삼성전자', detail: '2%' }],
    });
    assert.equal(updated.portfolio.fileName, 'contract-v2.csv');
    assert.equal(updated.portfolio.createdAt, created.portfolio.createdAt);

    const { portfolios } = await store.listPortfolios(workspaceId);
    assert.equal(portfolios.length, 1);
    assert.equal(portfolios[0].id, portfolioId);

    const deleted = await store.deletePortfolio(workspaceId, portfolioId);
    assert.equal(deleted, true);
    assert.equal(await store.getPortfolio(workspaceId, portfolioId), null);
  });

  test(`${label}: updating a missing portfolio returns null`, async () => {
    const workspaceId = uniqueId('guest:contract');
    const result = await store.updatePortfolio(workspaceId, 'does-not-exist', { fileName: 'x.csv' });
    assert.equal(result, null);
  });

  test(`${label}: import history keeps most recent entries first and caps at 100`, async () => {
    const workspaceId = uniqueId('guest:contract');
    const first = await store.saveImportHistory(workspaceId, {
      fileName: 'a.csv',
      status: 'ok',
      itemCount: 1,
      securityCount: 1,
    });
    const second = await store.saveImportHistory(workspaceId, {
      fileName: 'b.csv',
      status: 'needs-review',
      itemCount: 2,
      securityCount: 2,
    });

    const { imports } = await store.listImportHistory(workspaceId);
    assert.equal(imports.length, 2);
    assert.equal(imports[0].id, second.importRecord.id);
    assert.equal(imports[1].id, first.importRecord.id);
  });

  test(`${label}: AI analyses upsert on matching portfolio/type/inputHash`, async () => {
    const workspaceId = uniqueId('guest:contract');
    const portfolioId = uniqueId('portfolio');

    await store.saveAiAnalysis(workspaceId, {
      portfolioId,
      analysisType: 'portfolio-summary',
      inputHash: 'hash-a',
      status: 'ready',
      result: { headline: 'first' },
    });
    await store.saveAiAnalysis(workspaceId, {
      portfolioId,
      analysisType: 'portfolio-summary',
      inputHash: 'hash-a',
      status: 'ready',
      result: { headline: 'second' },
    });

    const { analyses } = await store.listAiAnalyses(workspaceId, {
      portfolioId,
      analysisType: 'portfolio-summary',
      inputHash: 'hash-a',
    });

    assert.equal(analyses.length, 1);
    assert.equal(analyses[0].result.headline, 'second');
  });

  test(`${label}: guest workspaces are accessible without authentication`, async () => {
    const workspaceId = uniqueId('guest:contract');
    const access = await store.ensureWorkspaceAccess(workspaceId, null);
    assert.equal(access.ok, true);
    assert.equal(access.mode, 'guest');
    assert.equal(access.role, 'owner');
  });

  test(`${label}: non-guest workspaces require authentication`, async () => {
    const workspaceId = uniqueId('team-contract');
    const access = await store.ensureWorkspaceAccess(workspaceId, null);
    assert.equal(access.ok, false);
    assert.equal(access.statusCode, 401);
  });

  test(`${label}: claiming a guest workspace merges records exactly once`, async () => {
    const suffix = uniqueId('claim');
    const guestWorkspaceId = `guest:${suffix}`;
    const targetWorkspaceId = `user:${suffix}`;
    const portfolioId = uniqueId('portfolio');
    const user = { id: `owner-${suffix}`, email: 'owner@example.com' };

    await store.createPortfolio(guestWorkspaceId, {
      id: portfolioId,
      fileName: 'guest.csv',
      items: [{ label: 'SCHD', detail: '1%' }],
    });

    const firstClaim = await store.claimGuestWorkspaceForUser({
      guestWorkspaceId,
      targetWorkspaceId,
      user,
    });
    assert.equal(firstClaim.ok, true);
    assert.equal(firstClaim.copied.portfolios, 1);

    const secondClaim = await store.claimGuestWorkspaceForUser({
      guestWorkspaceId,
      targetWorkspaceId,
      user,
    });
    assert.equal(secondClaim.ok, true);
    assert.equal(secondClaim.copied.portfolios, 0);

    const { portfolios } = await store.listPortfolios(targetWorkspaceId);
    assert.equal(portfolios.filter((entry) => entry.id === portfolioId).length, 1);
  });

  test(`${label}: concurrent writes to the same workspace don't drop each other`, async () => {
    const workspaceId = uniqueId('guest:concurrent');
    const concurrentWriteCount = 20;

    await Promise.all(
      Array.from({ length: concurrentWriteCount }, (_, index) =>
        store.createPortfolio(workspaceId, {
          id: `concurrent-portfolio-${index}`,
          fileName: `concurrent-${index}.csv`,
          items: [{ label: `Holding ${index}`, detail: '1%' }],
        }),
      ),
    );

    const { portfolios } = await store.listPortfolios(workspaceId);
    assert.equal(portfolios.length, concurrentWriteCount);
  });
}

registerContractSuite('file store', fileStore);

if (postgresStore) {
  registerContractSuite('postgres store', postgresStore);
} else {
  test('postgres store contract (skipped: DATABASE_URL not set)', { skip: true }, () => {});
}
