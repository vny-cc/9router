import { CODEBUDDY_PROVIDER_NAMES, CODEBUDDY_ACCOUNT_RESTRICTION } from "../config/codebuddyConstants.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";

// Read both the business code and its meaning. 11140 also has rate-limit
// variants, and unrelated providers must retain their existing error behavior.
export function isCodebuddyAccountRestriction(provider, status, message) {
  if (!CODEBUDDY_PROVIDER_NAMES.includes(provider) || Number(status) !== HTTP_STATUS.FORBIDDEN) return false;
  const text = typeof message === "string" ? message : JSON.stringify(message || "");
  const lower = text.toLowerCase();
  const hasCode = CODEBUDDY_ACCOUNT_RESTRICTION.codePattern.test(text);
  return hasCode && CODEBUDDY_ACCOUNT_RESTRICTION.markers.some((marker) => lower.includes(marker));
}

export function codebuddyRestrictionResponse(provider, status, message, extraHeaders = null) {
  if (!isCodebuddyAccountRestriction(provider, status, message)) return null;
  const text = typeof message === "string" ? message : JSON.stringify(message);
  const requestId = text.match(/"requestId"\s*:\s*"([^"]+)"/)?.[1];
  const headers = new Headers(extraHeaders || {});
  headers.set("Content-Type", "application/json");
  headers.set("Access-Control-Allow-Origin", "*");
  // Anthropic/OpenAI SDKs otherwise retry a router-generated 503. This is a
  // permission refusal, and a short retry does not repair the account.
  headers.delete("retry-after");
  headers.set("x-should-retry", "false");
  return new Response(JSON.stringify({
    error: {
      message: CODEBUDDY_ACCOUNT_RESTRICTION.message,
      type: CODEBUDDY_ACCOUNT_RESTRICTION.type,
      code: CODEBUDDY_ACCOUNT_RESTRICTION.code,
      upstream_code: CODEBUDDY_ACCOUNT_RESTRICTION.upstreamCode,
      ...(requestId ? { request_id: requestId } : {}),
    },
  }), { status: HTTP_STATUS.FORBIDDEN, headers });
}
