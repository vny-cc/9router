import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ credentials: vi.fn(), core: vi.fn(), mark: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false }) }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.credentials,
  markAccountUnavailable: mocks.mark,
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, model] = value.split("/"); return { provider, model }; },
  getComboModels: async () => null,
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: async () => ({}),
  enforceKeyAccess: async () => null,
  filterAdapterModels: async (_key, models) => models,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credentials) => credentials, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.core }));

import { handleChat } from "../../src/sse/handlers/chat.js";

const error = '[403]: {"code":11140,"msg":"request illegal","requestId":"request-1","displayMsg":{"en":"Your account has been restricted due to unusual activity"}}';
const locked = () => ({ allRateLimited: true, lastErrorCode: 403, lastError: error, retryAfter: new Date(Date.now() + 120000).toISOString(), retryAfterHuman: "reset after 2 minutes" });
const request = () => new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "codebuddy-intl/deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }], stream: false }) });

beforeEach(() => { vi.resetAllMocks(); mocks.mark.mockResolvedValue({ shouldFallback: true }); });

describe("CodeBuddy chat restriction retry regression", () => {
  it("returns 403 immediately for cached restrictions without another upstream call", async () => {
    mocks.credentials.mockResolvedValue(locked());
    const response = await handleChat(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(response.headers.get("retry-after")).toBeNull();
    expect((await response.json()).error.code).toBe("account_restricted");
    expect(mocks.core).not.toHaveBeenCalled();
  });

  it("keeps the upstream permission status after exhausting accounts in the current request", async () => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "one" }).mockResolvedValueOnce({ connectionId: "two" }).mockResolvedValue(locked());
    mocks.core.mockImplementation(async () => ({ success: false, status: 403, error, response: new Response("{}", { status: 403 }) }));
    const response = await handleChat(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(mocks.core).toHaveBeenCalledTimes(2);
  });

  it("still reaches a healthy account after an earlier restriction", async () => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "one" }).mockResolvedValueOnce({ connectionId: "two" });
    mocks.core.mockResolvedValueOnce({ success: false, status: 403, error, response: new Response("{}", { status: 403 }) }).mockResolvedValueOnce({ success: true, response: new Response("OK") });
    const response = await handleChat(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(mocks.core).toHaveBeenCalledTimes(2);
  });

  it("retains the existing 503 and retry timing for ordinary quota cooldowns", async () => {
    mocks.credentials.mockResolvedValue({ ...locked(), lastErrorCode: 429, lastError: "quota exceeded" });
    const response = await handleChat(request());
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("x-should-retry")).toBeNull();
  });
});
