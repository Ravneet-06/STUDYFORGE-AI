export class ApiNetworkError extends Error {
  constructor(cause) {
    super("The StudyForge API could not be reached. Check your connection and try again.", {
      cause,
    });
    this.name = "ApiNetworkError";
    this.kind = "network";
  }
}

export class ApiAuthenticationError extends Error {
  constructor(message = "Your session has expired. Sign in again.") {
    super(message);
    this.name = "ApiAuthenticationError";
    this.kind = "authentication";
  }
}

export class ApiProviderError extends Error {
  constructor(message) {
    super(message || "The configured AI provider could not complete this request.");
    this.name = "ApiProviderError";
    this.kind = "provider";
  }
}

export async function restoreStoredSession({ savedSession, setSession, validateSession }) {
  if (!savedSession) return false;
  let restored;
  try {
    restored = JSON.parse(savedSession);
  } catch {
    setSession(null);
    return false;
  }
  setSession(restored);
  try {
    await validateSession();
    return true;
  } catch (error) {
    if (error instanceof ApiAuthenticationError) {
      setSession(null);
      return false;
    }
    throw error;
  }
}

export function singleFlight(action) {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return undefined;
    inFlight = true;
    try {
      return await action(...args);
    } finally {
      inFlight = false;
    }
  };
}

export function createApiClient({
  fetchImpl = fetch,
  waitForAuthReady,
  getAccessToken,
  onUnauthorized,
}) {
  return async function api(path, options = {}) {
    const { skipAuthReady = false, ...requestOptions } = options;
    if (!skipAuthReady) await waitForAuthReady();

    const headers = { "content-type": "application/json", ...(requestOptions.headers || {}) };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(path, { ...requestOptions, headers });
    } catch (error) {
      throw new ApiNetworkError(error);
    }

    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/auth/config") {
      await onUnauthorized();
      throw new ApiAuthenticationError();
    }
    if (!response.ok) {
      if (String(data.error?.code || "").startsWith("foundry_")) {
        throw new ApiProviderError(data.error.message);
      }
      const error = new Error(data.error?.message || data.error || "Something went wrong.");
      error.kind = "api";
      error.status = response.status;
      throw error;
    }
    return data;
  };
}
