import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareClaudeRequest, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { isOfficialAnthropicEndpoint, CLAUDE_CLI_USER_AGENT } from "../../open-sse/providers/shared.js";
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
const provider = "anthropic-compatible-capi";
const credentials = { apiKey: "test-key", providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" } };
const thinking = { type: "thinking", thinking: "A summary", signature: "opaque-signature-returned-by-upstream" };
const redacted = { type: "redacted_thinking", data: "opaque-encrypted-data" };
const tool = { type: "tool_use", id: "toolu_test", name: "lookup", input: {} };
const history = () => ({ model: "claude-opus-5-5", max_tokens: 1024, thinking: { type: "adaptive" }, messages: [
  { role: "user", content: "Hello" },
  { role: "assistant", content: [structuredClone(thinking), structuredClone(redacted), structuredClone(tool)] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_test", content: "result" }] },
] });
afterEach(() => vi.resetAllMocks());
describe("first-party Anthropic continuation", () => {
  it("sends the initial turn and multiple tool continuations without replacing signed history", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    const executor = new DefaultExecutor(provider);
    const body = history();
    for (const input of [{ ...body, messages: [body.messages[0]] }, body, structuredClone(body)]) {
      const prepared = prepareClaudeRequest(structuredClone(input), provider, credentials.apiKey, null, null, null, credentials);
      const result = await executor.execute({ model: body.model, body: prepared, stream: false, credentials });
      expect(result.response.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(options.headers["User-Agent"]).toBe(CLAUDE_CLI_USER_AGENT);
    }
    for (const [, options] of fetchMock.mock.calls.slice(1)) {
      const sent = JSON.parse(options.body).messages.find(m => m.role === "assistant");
      expect(sent.content.find(b => b.type === "thinking")).toEqual(thinking);
      expect(sent.content.find(b => b.type === "redacted_thinking")).toEqual(redacted);
    }
  });
  it("retains signed history through the translator entry point", () => {
    const input = history();
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, input.model, input, false, credentials, provider);
    const assistant = out.messages.find(m => m.role === "assistant");
    expect(assistant.content.find(b => b.type === "thinking")).toEqual(thinking);
    expect(assistant.content.find(b => b.type === "redacted_thinking")).toEqual(redacted);
  });
  it("preserves redacted data and opaque signatures on native passthrough", () => {
    const body = history();
    normalizeClaudePassthrough(body, body.model, true);
    expect(body.messages[1].content.slice(0, 2)).toEqual([thinking, redacted]);
  });
  it("retains signed history when the thinking summary is omitted", () => {
    const body = history();
    body.messages[1].content[0].thinking = "";
    normalizeClaudePassthrough(body, body.model, true);
    expect(body.messages[1].content[0]).toEqual({ ...thinking, thinking: "" });
  });
  it("does not invent a signed thinking block for a first-party tool turn", () => {
    const body = history(); body.thinking = { type: "enabled", budget_tokens: 128 };
    body.messages[1].content = [structuredClone(tool)];
    const out = prepareClaudeRequest(body, provider, "test-key", null, null, null, credentials);
    expect(out.messages[1].content.map(b => b.type)).toEqual(["tool_use"]);
  });
  it("keeps the existing gateway signature handling for third parties", () => {
    const out = prepareClaudeRequest(history(), provider, "test-key", null, null, null, { providerSpecificData: { baseUrl: "https://gateway.example/v1" } });
    expect(out.messages[1].content.find(b => b.type === "thinking").signature).not.toBe(thinking.signature);
  });
  it.each(["https://api.anthropic.com.evil.example/v1", "https://gateway.example/api.anthropic.com", "http://api.anthropic.com/v1", "invalid"])("does not treat %s as first party", base => {
    expect(isOfficialAnthropicEndpoint(provider, base)).toBe(false);
  });
});
