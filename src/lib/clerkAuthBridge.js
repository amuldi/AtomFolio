// storage.js issues plain fetch() calls outside of React, so it can't call Clerk's useAuth()
// hook directly. AuthPanel registers its token getter here once a Clerk session is active, and
// every outgoing request asks this module for a fresh Authorization header.
let tokenGetter = null;

export function setClerkTokenGetter(getter) {
  tokenGetter = typeof getter === 'function' ? getter : null;
}

export async function getClerkAuthorizationHeader() {
  if (!tokenGetter) {
    return null;
  }

  try {
    const token = await tokenGetter();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}
