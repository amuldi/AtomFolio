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

test('production ignores trusted auth headers even when the flag is explicitly enabled', async () => {
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

  // Even an explicit opt-in must not work on Vercel: a stray env var should never let
  // header-spoofed requests impersonate a user in production.
  process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS = 'true';

  const stillIgnoredContext = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: {
      'x-atomfolio-workspace-id': 'prod-team',
      'x-atomfolio-user-id': 'spoofed-user-2',
    },
  });

  assert.equal(stillIgnoredContext.ok, false);
  assert.equal(stillIgnoredContext.statusCode, 401);
});

test('production rejects unauthenticated access to a non-guest workspace id', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: { 'x-atomfolio-workspace-id': 'team-prod-guess' },
  });

  assert.equal(context.ok, false);
  assert.equal(context.statusCode, 401);
  assert.equal(context.code, 'workspace-auth-required');
});

test('production accepts a guest workspace id shaped like a real UUID (what the client actually generates)', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';

  const context = await workspaceAccess.resolveWorkspaceRequestContext(
    { headers: { 'x-atomfolio-workspace-id': 'guest:3fa85f64-5717-4562-b3fc-2c963f66afa6' } },
    { requiredRole: 'editor' },
  );

  assert.equal(context.ok, true);
  assert.equal(context.mode, 'guest');
  assert.equal(context.role, 'owner');
});

test('production rejects a guessable/short guest workspace id', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';

  const context = await workspaceAccess.resolveWorkspaceRequestContext({
    headers: { 'x-atomfolio-workspace-id': 'guest:test-workspace' },
  });

  assert.equal(context.ok, false);
  assert.equal(context.statusCode, 401);
  assert.equal(context.code, 'guest-workspace-id-invalid');
});

test('production rejects the shared "anonymous" workspace id from unauthenticated requests', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';

  const context = await workspaceAccess.resolveWorkspaceRequestContext({ headers: {} });

  assert.equal(context.ok, false);
  assert.equal(context.statusCode, 401);
  assert.equal(context.code, 'guest-workspace-id-invalid');
});

test('outside production, a short guest workspace id (dev fixtures) is still accepted', async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;

  const context = await workspaceAccess.resolveWorkspaceRequestContext(
    { headers: { 'x-atomfolio-workspace-id': 'guest:dev-fixture' } },
    { requiredRole: 'editor' },
  );

  assert.equal(context.ok, true);
  assert.equal(context.mode, 'guest');
});

test('a verified bearer token authenticates a request even in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  const authContext = await workspaceAccess.resolveAuthContext(
    {
      headers: {
        authorization: 'Bearer valid-test-token',
      },
    },
    {
      verifyBearerToken: async (token) => {
        assert.equal(token, 'valid-test-token');
        return { id: 'clerk-user-1', email: '', displayName: '', authProvider: 'clerk', authSubject: 'clerk-user-1' };
      },
    },
  );

  assert.equal(authContext.trusted, true);
  assert.equal(authContext.user.id, 'clerk-user-1');
  assert.equal(authContext.user.authProvider, 'clerk');
});

test('an invalid bearer token falls back to unauthenticated in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  const authContext = await workspaceAccess.resolveAuthContext(
    {
      headers: {
        authorization: 'Bearer garbage-token',
      },
    },
    {
      verifyBearerToken: async () => null,
    },
  );

  assert.equal(authContext.trusted, false);
  assert.equal(authContext.user, null);
});

test('a device-connection-code-shaped bearer token is recognized and routed, not treated as a Clerk JWT', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  delete process.env.ATOMFOLIO_TRUSTED_AUTH_HEADERS;

  // No CLERK_SECRET_KEY/Postgres wired up in this test file's env, so the real default resolver
  // (server/workspaceAccess.mjs's verifyClerkOrDeviceToken) can't actually authenticate this —
  // the point here is that it fails *gracefully* as "unauthenticated" rather than the
  // atomfolio_dt_-prefixed value ever being handed to Clerk's verifyToken as if it were a JWT
  // (which would be a wasted round trip in production and a confusing error either way).
  const authContext = await workspaceAccess.resolveAuthContext({
    headers: {
      authorization: `Bearer atomfolio_dt_${'a'.repeat(32)}`,
    },
  });

  assert.equal(authContext.trusted, false);
  assert.equal(authContext.user, null);
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
