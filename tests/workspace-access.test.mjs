import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const originalStoreDriver = process.env.ATOMFOLIO_STORE_DRIVER;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;
const originalTrustedHeaders = process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

process.env.ATOMFOLIO_STORE_DRIVER = 'memory';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

after(() => {
  if (originalStoreDriver == null) {
    delete process.env.ATOMFOLIO_STORE_DRIVER;
  } else {
    process.env.ATOMFOLIO_STORE_DRIVER = originalStoreDriver;
  }

  if (originalNodeEnv == null) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalVercel == null) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = originalVercel;
  }

  if (originalTrustedHeaders == null) {
    delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;
  } else {
    process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS = originalTrustedHeaders;
  }
});

const workspaceAccess = await import('../server/workspaceAccess.mjs');
const portfolioStore = await import('../server/portfolioStore.mjs');

test('guest workspaces remain available without authentication', async () => {
  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': 'guest:test-workspace',
    },
  }, { requiredRole: 'editor' });

  assert.equal(context.ok, true);
  assert.equal(context.workspaceId, 'guest:test-workspace');
  assert.equal(context.mode, 'guest');
  assert.equal(context.role, 'owner');
});

test('custom workspaces require an authenticated user context', async () => {
  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': 'team-alpha',
    },
  });

  assert.equal(context.ok, false);
  assert.equal(context.statusCode, 401);
  assert.equal(context.code, 'workspace-auth-required');
});

test('trusted auth headers claim a new workspace for the first user', async () => {
  const workspaceId = `team-${Date.now()}-owner`;
  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': workspaceId,
      'x-atomfolio-user-id': 'user-1',
      'x-atomfolio-user-email': 'USER1@example.com',
    },
  }, { requiredRole: 'editor' });

  assert.equal(context.ok, true);
  assert.equal(context.workspaceId, workspaceId);
  assert.equal(context.userId, 'user-1');
  assert.equal(context.role, 'owner');
  assert.equal(context.mode, 'authenticated');
});

test('authenticated requests without an explicit workspace use a user workspace', async () => {
  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-user-id': 'default-user',
    },
  }, { requiredRole: 'editor' });

  assert.equal(context.ok, true);
  assert.equal(context.workspaceId, 'user:default-user');
  assert.equal(context.userId, 'default-user');
  assert.equal(context.role, 'owner');
});

test('a different authenticated user cannot access another owner workspace', async () => {
  const workspaceId = `team-${Date.now()}-isolated`;
  const firstContext = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': workspaceId,
      'x-atomfolio-user-id': 'owner-user',
    },
  }, { requiredRole: 'editor' });

  assert.equal(firstContext.ok, true);

  const secondContext = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': workspaceId,
      'x-atomfolio-user-id': 'other-user',
    },
  });

  assert.equal(secondContext.ok, false);
  assert.equal(secondContext.statusCode, 403);
  assert.equal(secondContext.code, 'workspace-access-denied');
});

test('production ignores auth headers unless trusted headers are explicitly enabled', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  const ignoredContext = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': 'prod-team',
      'x-atomfolio-user-id': 'spoofed-user',
    },
  });

  assert.equal(ignoredContext.ok, false);
  assert.equal(ignoredContext.statusCode, 401);

  process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS = 'true';

  const trustedContext = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': 'prod-team',
      'x-atomfolio-user-id': 'verified-user',
    },
  });

  assert.equal(trustedContext.ok, true);
  assert.equal(trustedContext.userId, 'verified-user');
});

test('claimGuestWorkspaceForUser copies guest records into a user workspace once', async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const guestWorkspaceId = `guest:claim-${suffix}`;
  const targetWorkspaceId = `user:claim-owner-${suffix}`;
  const portfolioId = `portfolio-${suffix}`;
  const importId = `import-${suffix}`;
  const user = { id: `claim-owner-${suffix}`, email: 'owner@example.com' };

  await portfolioStore.createPortfolio(guestWorkspaceId, {
    id: portfolioId,
    fileName: 'claim.csv',
    items: [{ label: '삼성전자', detail: '1%' }],
    timelineItems: [{ label: '삼성전자', detail: '1%' }],
  });
  await portfolioStore.saveImportHistory(guestWorkspaceId, {
    id: importId,
    portfolioId,
    fileName: 'claim.csv',
    status: 'ok',
    itemCount: 1,
    securityCount: 1,
  });

  const firstClaim = await portfolioStore.claimGuestWorkspaceForUser({
    guestWorkspaceId,
    targetWorkspaceId,
    user,
  });

  assert.equal(firstClaim.ok, true);
  assert.equal(firstClaim.copied.portfolios, 1);
  assert.equal(firstClaim.copied.imports, 1);

  const secondClaim = await portfolioStore.claimGuestWorkspaceForUser({
    guestWorkspaceId,
    targetWorkspaceId,
    user,
  });

  assert.equal(secondClaim.ok, true);
  assert.equal(secondClaim.copied.portfolios, 0);
  assert.equal(secondClaim.copied.imports, 0);

  const targetPortfolios = await portfolioStore.listPortfolios(targetWorkspaceId);
  const targetImports = await portfolioStore.listImportHistory(targetWorkspaceId);
  assert.equal(targetPortfolios.portfolios.filter((entry) => entry.id === portfolioId).length, 1);
  assert.equal(targetImports.imports.filter((entry) => entry.id === importId).length, 1);
});

test('claimGuestWorkspaceForUser rejects unauthenticated and non-guest claims', async () => {
  const unauthenticated = await portfolioStore.claimGuestWorkspaceForUser({
    guestWorkspaceId: 'guest:no-user',
    targetWorkspaceId: 'user:no-user',
    user: null,
  });
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.statusCode, 401);

  const nonGuest = await portfolioStore.claimGuestWorkspaceForUser({
    guestWorkspaceId: 'team:not-guest',
    targetWorkspaceId: 'user:owner',
    user: { id: 'owner' },
  });
  assert.equal(nonGuest.ok, false);
  assert.equal(nonGuest.statusCode, 400);
  assert.equal(nonGuest.code, 'guest-workspace-required');
});
