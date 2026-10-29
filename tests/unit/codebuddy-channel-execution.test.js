import { afterEach, describe, expect, it, vi } from "vitest";

const { upstreamFetch, refreshCn, refreshIntl } = vi.hoisted(() => ({
  upstreamFetch: vi.fn(),
  refreshCn: vi.fn(),
  refreshIntl: vi.fn(),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: upstreamFetch }));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshCodebuddyToken: refreshCn,
  refreshCodebuddyIntlToken: refreshIntl,
}));

import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

afterEach(() => vi.resetAllMocks());

describe.each([
  ["CN", CodeBuddyExecutor, "copilot.tencent.com", refreshCn],
  ["Intl", CodeBuddyIntlExecutor, "www.codebuddy.ai", refreshIntl],
])("CodeBuddy %s execution", (_name, Executor, domain, refresh) => {
  it("sends channel headers and normalized messages through the real executor pipeline", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';
    upstreamFetch.mockResolvedValue(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const executor = new Executor();
    const result = await executor.execute({
      model: "glm-5.2",
      body: {
        model: "glm-5.2",
        messages: [
          { role: "system", content: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.\nPreserve this instruction." }] },
          { role: "developer", content: "Reply with OK." },
          { role: "user", content: "Say OK" },
        ],
      },
      stream: false,
      credentials: { apiKey: "test-api-key" },
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [url, request] = upstreamFetch.mock.calls[0];
    expect(url).toBe(`https://${domain}/v2/chat/completions`);
    expect(request.headers.Authorization).toBe("Bearer test-api-key");
    expect(request.headers.Accept).toBe("text/event-stream");
    expect(request.headers["X-Domain"]).toBe(domain);
    expect(request.headers["X-App"]).toBe("cli");
    const wireBody = JSON.parse(request.body);
    expect(wireBody.stream).toBe(true);
    expect(wireBody.model).toBe("glm-5.2");
    expect(wireBody.messages[0].content).toMatch(/^You are CodeBuddy Code\./);
    expect(wireBody.messages[0].content).toContain("Preserve this instruction.");
    expect(wireBody.messages[0].content).toContain("Reply with OK.");
    expect(wireBody.messages[0].content).not.toContain("You are Claude Code");
    expect(wireBody.messages[1].content).toEqual([{ type: "text", text: "Say OK" }]);
    expect(wireBody.reasoning_effort).toBeUndefined();
    expect(wireBody.reasoning_summary).toBeUndefined();
    expect(await result.response.text()).toBe(sse);
  });

  it("keeps long instructions, multimodal user content, and tool-call history", () => {
    const longInstruction = "Keep the project rules. ".repeat(150);
    const userContent = [{ type: "text", text: "Explain Claude Code" }, { type: "image_url", image_url: { url: "https://example.com/image.png" } }];
    const toolCalls = [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }];
    const toolResult = { role: "tool", tool_call_id: "call-1", content: "file contents" };
    const out = new Executor().transformRequest("glm-5.2", {
      messages: [
        { role: "system", content: longInstruction },
        { role: "developer", content: [{ type: "text", text: "Use strict JSON." }] },
        { role: "user", content: userContent },
        { role: "assistant", content: [{ type: "text", text: "OhMyOpenCode cc_entrypoint=cli" }], tool_calls: toolCalls },
        toolResult,
      ],
    }, true, {});
    expect(out.messages[0].content).toContain(longInstruction.trim());
    expect(out.messages[0].content).toContain("Use strict JSON.");
    expect(out.messages[1].content).toEqual(userContent);
    expect(out.messages[2].content[0].text).not.toMatch(/OhMyOpenCode|cc_entrypoint=cli/);
    expect(out.messages[2].tool_calls).toEqual(toolCalls);
    expect(out.messages[3]).toEqual(toolResult);
  });

  it("generates fresh request IDs while retaining auth and explicit domain overrides", () => {
    const executor = new Executor();
    const credentials = { accessToken: "test-oauth-token", providerSpecificData: { domain: "custom.example.com" } };
    const first = executor.buildHeaders(credentials, false);
    const second = executor.buildHeaders(credentials, false);
    expect(first.Authorization).toBe("Bearer test-oauth-token");
    expect(first["X-Domain"]).toBe("custom.example.com");
    expect(first["X-Conversation-Message-ID"]).toBe(first["X-Request-ID"]);
    for (const key of ["X-Request-ID", "X-Conversation-ID", "X-Conversation-Request-ID"]) {
      expect(first[key]).not.toBe(second[key]);
    }
  });

  it("uses the matching OAuth refresh function and skips missing refresh tokens", async () => {
    const executor = new Executor();
    expect(await executor.refreshCredentials({})).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    const tokens = { accessToken: "new-token", refreshToken: "next-token" };
    refresh.mockResolvedValue(tokens);
    expect(await executor.refreshCredentials({ refreshToken: "refresh-token" })).toEqual(tokens);
    expect(refresh).toHaveBeenCalledWith("refresh-token", undefined);
    expect(refresh === refreshCn ? refreshIntl : refreshCn).not.toHaveBeenCalled();
  });
});
