import {
  ensureWorkspaceAccess,
  resolveWorkspaceId,
} from './portfolioStore.mjs';

const TRUSTED_AUTH_HEADER_FLAG = 'ATOMFOLIO_TRUSTED_AUTH_HEADERS';

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();

  if (!headers) {
    return '';
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(lowerName) ?? '';
  }

  return headers[name] ?? headers[lowerName] ?? '';
}

function cleanHeaderText(value, maxLength = 180) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function shouldTrustAuthHeaders() {
  const flag = String(process.env[TRUSTED_AUTH_HEADER_FLAG] ?? '').trim().toLowerCase();

  if (flag === 'true' || flag === '1' || flag === 'yes') {
    return true;
  }

  if (flag === 'false' || flag === '0' || flag === 'no') {
    return false;
  }

  return process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1';
}

function shouldAllowQueryWorkspaceId() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL !== '1' ||
    process.env.ATOMFOLIO_ALLOW_QUERY_WORKSPACE_ID === 'true'
  );
}

function hasExplicitWorkspaceId(requestOrValue) {
  const headers = requestOrValue?.headers ?? {};
  const headerWorkspaceId = cleanHeaderText(getHeader(headers, 'x-atomfolio-workspace-id'), 120);
  const queryWorkspaceId = shouldAllowQueryWorkspaceId()
    ? cleanHeaderText(requestOrValue?.query?.workspaceId, 120)
    : '';

  return Boolean(headerWorkspaceId || queryWorkspaceId);
}

export function resolveAuthContext(requestOrValue) {
  if (!shouldTrustAuthHeaders()) {
    return {
      trusted: false,
      user: null,
    };
  }

  const headers = requestOrValue?.headers ?? {};
  const userId = cleanHeaderText(getHeader(headers, 'x-atomfolio-user-id'), 120);

  if (!userId) {
    return {
      trusted: true,
      user: null,
    };
  }

  return {
    trusted: true,
    user: {
      id: userId,
      email: cleanHeaderText(getHeader(headers, 'x-atomfolio-user-email'), 254),
      displayName: cleanHeaderText(getHeader(headers, 'x-atomfolio-user-name'), 180),
      authProvider: cleanHeaderText(getHeader(headers, 'x-atomfolio-auth-provider'), 80) || 'trusted-header',
      authSubject: cleanHeaderText(getHeader(headers, 'x-atomfolio-auth-subject'), 180) || userId,
    },
  };
}

export async function resolveWorkspaceRequestContext(requestOrValue, { requiredRole = 'viewer' } = {}) {
  const authContext = resolveAuthContext(requestOrValue);
  const workspaceId =
    authContext.user && !hasExplicitWorkspaceId(requestOrValue)
      ? `user:${authContext.user.id}`
      : resolveWorkspaceId(requestOrValue);
  const access = await ensureWorkspaceAccess(workspaceId, authContext.user, { requiredRole });

  return {
    ...access,
    authContext,
  };
}

export function resolveWorkspaceSessionContext(requestOrValue) {
  const authContext = resolveAuthContext(requestOrValue);
  const workspaceId =
    authContext.user && !hasExplicitWorkspaceId(requestOrValue)
      ? `user:${authContext.user.id}`
      : resolveWorkspaceId(requestOrValue);

  return {
    authenticated: Boolean(authContext.user),
    trusted: Boolean(authContext.trusted),
    workspaceId,
    user: authContext.user
      ? {
          id: authContext.user.id,
          email: authContext.user.email || null,
          displayName: authContext.user.displayName || null,
        }
      : null,
  };
}

export function sendWorkspaceAccessError(access, sendJson) {
  sendJson(access.statusCode || 403, {
    error: access.error || 'Workspace access denied.',
    code: access.code || 'workspace-access-denied',
    workspaceId: access.workspaceId,
  });
}
