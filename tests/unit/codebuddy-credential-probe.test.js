import { describe, expect, it, vi } from "vitest";
import { probeCodebuddyCredentials } from "../../open-sse/services/codebuddyProbe.js";

const connection = { provider: "codebuddy-intl", apiKey: "test-api-key" };

describe("CodeBuddy API key probe", () => {
  it("tests a real completion with the required channel headers", async () => {
    const fetchFn = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'));
    expect(await probeCodebuddyCredentials(connection, fetchFn)).toEqual({ valid: true, error: null });
    const [url, request] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer test-api-key");
    expect(request.headers["X-App"]).toBe("cli");
    expect(JSON.parse(request.body)).toMatchObject({ stream: true, max_tokens: 1 });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports the account restriction rather than a generic unsupported-provider error", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ code: 11140, msg: "request illegal", displayMsg: { en: "Your account has been restricted due to unusual activity" } }), { status: 403 });
    expect(await probeCodebuddyCredentials(connection, fetchFn)).toEqual({
      valid: false,
      error: "Your account has been restricted due to unusual activity (code 11140)",
    });
  });

  it("rejects an error embedded in an HTTP 200 SSE response", async () => {
    const fetchFn = async () => new Response('data: {"error":{"message":"invalid token"}}\n\n');
    expect(await probeCodebuddyCredentials(connection, fetchFn)).toEqual({ valid: false, error: "invalid token" });
  });

  it("does not report an empty response as a working connection", async () => {
    expect(await probeCodebuddyCredentials(connection, async () => new Response(""))).toEqual({ valid: false, error: "CodeBuddy returned no chat completion" });
  });
});
