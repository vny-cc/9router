import { CREDIT_BALANCE_ERROR_TEXTS } from "../config/errorConfig.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { errorResponse } from "./error.js";

// Keep account backoff, but do not turn a known billing rejection into a
// retryable server outage when every credential is locked.
export function anthropicBillingResponse(provider, status, message, extraHeaders = null) {
  if (provider !== "anthropic" && provider !== "claude" && !provider?.startsWith("anthropic-compatible-")) return null;
  const code = Number(status);
  if (code !== HTTP_STATUS.BAD_REQUEST && code !== HTTP_STATUS.PAYMENT_REQUIRED) return null;
  const text = typeof message === "string" ? message : JSON.stringify(message || "");
  if (!CREDIT_BALANCE_ERROR_TEXTS.some(part => text.toLowerCase().includes(part))) return null;
  const headers = new Headers(extraHeaders || {});
  headers.delete("retry-after");
  headers.set("x-should-retry", "false");
  return errorResponse(code, text, Object.fromEntries(headers));
}
