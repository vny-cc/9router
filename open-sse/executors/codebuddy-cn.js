import { DefaultExecutor } from "./default.js";
import { randomUUID } from "node:crypto";
import { refreshCodebuddyToken, refreshCodebuddyIntlToken } from "../services/tokenRefresh.js";
import {
  CODEBUDDY_SYSTEM_PROMPT,
  CODEBUDDY_EXTERNAL_IDENTITY,
  CODEBUDDY_CHANNEL_HEADERS,
  CODEBUDDY_CHANNEL_MARKERS,
  CODEBUDDY_CHANNEL_MARKER_REGEX,
} from "../config/codebuddyConstants.js";
import { ROLE } from "../translator/schema/roles.js";
import { OPENAI_BLOCK } from "../translator/schema/blocks.js";

function sanitizeChannelMarkers(text) {
  if (typeof text !== "string" || !text) return text;
  let result = text;
  for (const marker of CODEBUDDY_CHANNEL_MARKERS) {
    if (result.includes(marker)) {
      result = result.split(marker).join(CODEBUDDY_EXTERNAL_IDENTITY);
    }
  }
  return result.replace(CODEBUDDY_CHANNEL_MARKER_REGEX, CODEBUDDY_EXTERNAL_IDENTITY);
}

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions
 *
 * CodeBuddy is OpenAI-compatible but rejects non-stream chat requests
 * (HTTP 400, code 11101 "Non-stream chat request is currently not supported").
 * The same-format (openai→openai) translator path leaves body.stream as the
 * client sent it, so we force it true here — 9router still re-aggregates the
 * SSE into a JSON response for non-streaming clients.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor(provider = "codebuddy-cn") {
    super(provider);
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, true, url, model, body);
    const reqId = randomUUID().replace(/-/g, "");
    const convId = randomUUID();
    const convReqId = randomUUID().replace(/-/g, "");
    const domain =
      credentials?.providerSpecificData?.domain ||
      new URL(this.config.baseUrl).hostname;

    delete headers["x-requested-with"];
    delete headers["x-codebuddy-request"];

    Object.assign(headers, {
      ...CODEBUDDY_CHANNEL_HEADERS,
      "X-Domain": domain,
      "X-Stainless-Runtime-Version": process.version,
      "X-Request-ID": reqId,
      "X-Conversation-ID": convId,
      "X-Conversation-Request-ID": convReqId,
      "X-Conversation-Message-ID": reqId,
    });

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const nextBody = super.transformRequest(model, body, stream, credentials);
    nextBody.stream = true;
    const effort = nextBody.reasoning_effort;
    if (effort === "none" || effort === "off") {
      delete nextBody.reasoning_effort;
    } else if (effort) {
      nextBody.reasoning_summary = "auto";
    }

    const inputMessages = Array.isArray(nextBody.messages) ? nextBody.messages : [];
    const systemParts = [CODEBUDDY_SYSTEM_PROMPT];
    const otherMessages = [];

    for (const message of inputMessages) {
      if (!message || typeof message !== "object") continue;
      if (message.role === ROLE.SYSTEM || message.role === ROLE.DEVELOPER) {
        const rawText =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map((block) => (typeof block === "string" ? block : block && typeof block.text === "string" ? block.text : ""))
                  .join("\n")
              : "";
        const cleaned = sanitizeChannelMarkers(rawText).trim();
        if (cleaned && cleaned !== CODEBUDDY_SYSTEM_PROMPT) systemParts.push(cleaned);
        continue;
      }
      if (message.role === ROLE.USER && typeof message.content === "string") {
        otherMessages.push({ ...message, content: [{ type: OPENAI_BLOCK.TEXT, text: message.content }] });
        continue;
      }
      if (message.role === ROLE.ASSISTANT) {
        const nextMessage = { ...message };
        if (typeof nextMessage.content === "string") {
          nextMessage.content = sanitizeChannelMarkers(nextMessage.content);
        } else if (Array.isArray(nextMessage.content)) {
          nextMessage.content = nextMessage.content.map((block) =>
            block && typeof block === "object" && typeof block.text === "string"
              ? { ...block, text: sanitizeChannelMarkers(block.text) }
              : block
          );
        }
        otherMessages.push(nextMessage);
        continue;
      }
      otherMessages.push({ ...message });
    }

    nextBody.messages = [{ role: ROLE.SYSTEM, content: systemParts.join("\n\n") }, ...otherMessages];
    return nextBody;
  }
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return this.provider === "codebuddy-intl"
      ? refreshCodebuddyIntlToken(credentials.refreshToken, log)
      : refreshCodebuddyToken(credentials.refreshToken, log);
  }
}

export default CodeBuddyExecutor;
