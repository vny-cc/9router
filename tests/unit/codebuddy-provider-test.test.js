import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe.each(["codebuddy-cn", "codebuddy-intl"])("%s dashboard API key Test", (provider) => {
  it("uses the channel-aware probe and saves the actual upstream restriction", async () => {
    mocks.get.mockResolvedValue({ id: "connection-1", provider, authType: "apikey", apiKey: "test-key" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 11140, displayMsg: { en: "Account restricted" } }), { status: 403 })));
    const result = await testSingleConnection("connection-1");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Account restricted (code 11140)");
    expect(mocks.update).toHaveBeenCalledWith("connection-1", expect.objectContaining({ testStatus: "error", lastError: "Account restricted (code 11140)" }));
    expect(fetch.mock.calls[0][1].headers["X-App"]).toBe("cli");
  });
});
