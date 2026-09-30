import { describe, expect, it, vi } from "vitest";
import {
  ApiAuthenticationError,
  ApiNetworkError,
  ApiProviderError,
  createApiClient,
  restoreStoredSession,
  singleFlight,
} from "../apps/web/api-client.mjs";

describe("frontend API client lifecycle", () => {
  it("holds protected requests until auth and session restoration are ready", async () => {
    let ready;
    const authReady = new Promise((resolve) => {
      ready = resolve;
    });
    const fetchImpl = vi.fn(async (_path, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ authorization: options.headers.Authorization }),
    }));
    const api = createApiClient({
      fetchImpl,
      waitForAuthReady: () => authReady,
      getAccessToken: () => "restored-token",
      onUnauthorized: vi.fn(),
    });

    let finished = false;
    const request = api("/api/assistant", { method: "POST" }).then((result) => {
      finished = true;
      return result;
    });
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finished).toBe(false);

    ready();
    await expect(request).resolves.toEqual({ authorization: "Bearer restored-token" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("allows only initialization requests to bypass the auth readiness gate", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const waitForAuthReady = vi.fn(() => Promise.resolve());
    const api = createApiClient({
      fetchImpl,
      waitForAuthReady,
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await api("/api/health", { skipAuthReady: true });
    expect(waitForAuthReady).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("skipAuthReady");

    await api("/api/documents");
    expect(waitForAuthReady).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved session when validation fails at the network layer", async () => {
    const setSession = vi.fn();
    await expect(
      restoreStoredSession({
        savedSession: JSON.stringify({ access_token: "saved-token" }),
        setSession,
        validateSession: async () => {
          throw new ApiNetworkError(new TypeError("Failed to fetch"));
        },
      }),
    ).rejects.toBeInstanceOf(ApiNetworkError);
    expect(setSession).toHaveBeenNthCalledWith(1, { access_token: "saved-token" });
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it("clears a saved session only when the API rejects its credentials", async () => {
    const setSession = vi.fn();
    await expect(
      restoreStoredSession({
        savedSession: JSON.stringify({ access_token: "expired-token" }),
        setSession,
        validateSession: async () => {
          throw new ApiAuthenticationError();
        },
      }),
    ).resolves.toBe(false);
    expect(setSession).toHaveBeenNthCalledWith(1, { access_token: "expired-token" });
    expect(setSession).toHaveBeenNthCalledWith(2, null);
  });

  it("coalesces duplicate in-flight ingest actions without suppressing later submissions", async () => {
    let finish;
    const action = vi.fn((payload) =>
      payload === "payload"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve("next saved"),
    );
    const ingestOnce = singleFlight(action);

    const first = ingestOnce("payload");
    const duplicate = await ingestOnce("payload");
    expect(duplicate).toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);

    finish("saved");
    await expect(first).resolves.toBe("saved");
    await expect(ingestOnce("next payload")).resolves.toBe("next saved");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a transport failure from API and authentication responses", async () => {
    const api = createApiClient({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      waitForAuthReady: () => Promise.resolve(),
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });
    await expect(api("/api/documents")).rejects.toBeInstanceOf(ApiNetworkError);

    const onUnauthorized = vi.fn();
    const unauthorizedApi = createApiClient({
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      waitForAuthReady: () => Promise.resolve(),
      getAccessToken: () => null,
      onUnauthorized,
    });
    await expect(unauthorizedApi("/api/documents")).rejects.toBeInstanceOf(ApiAuthenticationError);
    expect(onUnauthorized).toHaveBeenCalledOnce();

    const providerApi = createApiClient({
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        json: async () => ({
          error: {
            code: "foundry_unavailable",
            message: "Microsoft Foundry could not complete this request. Try again shortly.",
          },
        }),
      }),
      waitForAuthReady: () => Promise.resolve(),
      getAccessToken: () => "token",
      onUnauthorized: vi.fn(),
    });
    await expect(providerApi("/api/assistant")).rejects.toBeInstanceOf(ApiProviderError);
  });
});
