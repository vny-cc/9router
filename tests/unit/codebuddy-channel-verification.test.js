import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddy channel verification (error 11128)", () => {
  it("sets required CLI and Stainless channel headers for both providers", () => {
    const cnHeaders = new CodeBuddyExecutor().buildHeaders({ accessToken: "tok-cn" }, true, "https://copilot.tencent.com/v2/chat/completions", "glm-5.2", {});
    const intlHeaders = new CodeBuddyIntlExecutor().buildHeaders({ accessToken: "tok-intl" }, true, "https://www.codebuddy.ai/v2/chat/completions", "glm-5.2", {});

    for (const headers of [cnHeaders, intlHeaders]) {
      expect(headers["User-Agent"]).toBe("CLI/2.108.1 CodeBuddy/2.108.1");
      expect(headers["X-App"]).toBe("cli");
      expect(headers["X-IDE-Type"]).toBe("CLI");
      expect(headers["X-IDE-Name"]).toBe("CLI");
      expect(headers["X-IDE-Version"]).toBe("2.108.1");
      expect(headers["X-Stainless-Lang"]).toBe("js");
      expect(headers["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
      expect(headers["X-Conversation-ID"]).toBeTruthy();
      expect(headers["X-Agent-Intent"]).toBe("craft");
      expect(headers["X-Agent-Purpose"]).toBe("conversation");
    }
    expect(cnHeaders["X-Domain"]).toBe("copilot.tencent.com");
    expect(intlHeaders["X-Domain"]).toBe("www.codebuddy.ai");
  });

  it("preserves caller instructions and sanitizes external client identity markers", () => {
    const out = new CodeBuddyIntlExecutor().transformRequest("glm-5.2", {
      messages: [
        { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude.\nAlways reply in JSON." },
        { role: "developer", content: "Follow strict schema rules." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "I am running with cc_entrypoint=cli" },
      ],
    }, true, {});

    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content.startsWith("You are CodeBuddy Code.")).toBe(true);
    expect(out.messages[0].content).toContain("Always reply in JSON.");
    expect(out.messages[0].content).toContain("Follow strict schema rules.");
    expect(out.messages[0].content).not.toContain("You are Claude Code");
    expect(out.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
    expect(out.messages[2].content).not.toContain("cc_entrypoint=cli");
    expect(out.messages[2].content).toContain("[external-client-identity]");
  });
});
