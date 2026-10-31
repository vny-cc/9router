import { describe, it, expect, vi } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(),
}));

const cases = [
  { label: "cache read and incremental write", input: 2, read: 696890, write: 476, output: 214 },
  { label: "first cache write with zero reads", input: 24, read: 0, write: 696890, output: 486 },
  { label: "no cache", input: 100, read: 0, write: 0, output: 20 },
];
function events(c) {
  return [
    { type: "message_start", message: { id: "msg_cache", model: "claude-opus-5-5", usage: {
      input_tokens: c.input, output_tokens: 0,
      cache_read_input_tokens: c.read, cache_creation_input_tokens: c.write,
    } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: c.output } },
    { type: "message_stop" },
  ];
}
const pricing = { input: 4, cached: 0.2, cache_creation: 5, output: 20 };
function check(usage, c) {
  const canonical = canonicalizeUsage(usage);
  expect(canonical.prompt_tokens).toBe(c.input + c.read + c.write);
  expect(canonical.cached_tokens).toBe(c.read);
  expect(canonical.cache_creation_input_tokens).toBe(c.write);
  expect(canonical.completion_tokens).toBe(c.output);
  expect(canonicalizeUsage(canonical)).toEqual(canonical);
  expect(calculateCostFromTokens(canonical, pricing)).toBeCloseTo(
    (c.input * 4 + c.read * 0.2 + c.write * 5 + c.output * 20) / 1e6, 12,
  );
}

describe("Claude streaming cache accounting", () => {
  for (const c of cases) {
    it(`counts cache once after translating ${c.label}`, () => {
      const state = {};
      const chunks = events(c);
      claudeToOpenAIResponse(chunks[0], state);
      check({ ...state.usage, completion_tokens: c.output }, c);
      for (const chunk of chunks.slice(1)) claudeToOpenAIResponse(chunk, state);
      check(state.usage, c);
    });

    for (const target of [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES]) {
      it(`preserves correct storage/cost through SSE to ${target}: ${c.label}`, async () => {
        let captured;
        const transform = createSSETransformStreamWithLogger(
          FORMATS.CLAUDE, target, "anthropic", null, null, "claude-opus-5-5", null, {},
          (_content, usage) => { captured = usage; },
        );
        const wire = events(c).map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
        const source = new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(wire)); controller.close();
        } });
        await new Response(source.pipeThrough(transform)).text();
        check(captured, c);
      });
    }
  }
});
