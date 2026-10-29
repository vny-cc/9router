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

const provider = "anthropic-compatible-capi";
const billing = "Your credit balance is too low to access the Anthropic API.";
const locked = (code = 400, message = billing) => ({ allRateLimited: true, lastErrorCode: code, lastError: message, retryAfter: new Date(Date.now() + 120000).toISOString(), retryAfterHuman: "2 minutes" });
const request = () => new Request("http://localhost/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: provider + "/claude-opus-5-5", messages: [{ role: "user", content: "hi" }], stream: false }) });
beforeEach(() => { vi.resetAllMocks(); mocks.mark.mockResolvedValue({ shouldFallback: true }); });
describe("Anthropic billing rejections", () => {
  it("preserves 400 on repeated requests during a billing lock without contacting upstream", async () => {
    mocks.credentials.mockResolvedValue(locked());
    for (let i = 0; i < 3; i++) {
      const response = await handleChat(request());
      expect(response.status).toBe(400);
      expect(response.headers.get("x-should-retry")).toBe("false");
      expect(response.headers.get("retry-after")).toBeNull();
      expect((await response.json()).error.message).toContain(billing);
    }
    expect(mocks.core).not.toHaveBeenCalled();
  });
  it("preserves the original rejection after account fallback is exhausted", async () => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "one" }).mockResolvedValue(locked());
    mocks.core.mockResolvedValue({ success: false, status: 400, error: billing, response: new Response("{}", { status: 400 }) });
    const response = await handleChat(request());
    expect(response.status).toBe(400);
    expect(mocks.core).toHaveBeenCalledTimes(1);
  });
  it("can still reach a working account", async () => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "one" }).mockResolvedValueOnce({ connectionId: "two" });
    mocks.core.mockResolvedValueOnce({ success: false, status: 400, error: billing, response: new Response("{}", { status: 400 }) }).mockResolvedValueOnce({ success: true, response: new Response("OK") });
    expect((await handleChat(request())).status).toBe(200);
  });
  it.each([[429, "rate limit"], [503, "overloaded"], [400, "invalid parameter"]])("keeps existing cooldown behavior for %s %s", async (status, message) => {
    mocks.credentials.mockResolvedValue(locked(status, message));
    const response = await handleChat(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});
