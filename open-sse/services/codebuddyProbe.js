import { CodeBuddyExecutor } from "../executors/codebuddy-cn.js";
import { getDefaultModel } from "../config/providerModels.js";
import { CODEBUDDY_PROBE_TIMEOUT_MS, CODEBUDDY_PROBE_PROMPT, CODEBUDDY_PROBE_MAX_TOKENS } from "../config/codebuddyConstants.js";
import { ROLE } from "../translator/schema/roles.js";

function providerError(data, fallback) {
  const message = data?.displayMsg?.en || data?.error?.message || data?.msg || data?.message || fallback;
  return data?.code ? `${message} (code ${data.code})` : message;
}

// Exercise the same channel normalization as chat, through the connection's proxy.
export async function probeCodebuddyCredentials(connection, fetchFn) {
  const executor = new CodeBuddyExecutor(connection.provider);
  const model = connection.defaultModel || getDefaultModel(connection.provider);
  const body = executor.transformRequest(model, {
    model,
    messages: [{ role: ROLE.USER, content: CODEBUDDY_PROBE_PROMPT }],
    max_tokens: CODEBUDDY_PROBE_MAX_TOKENS,
  }, true, connection);
  const url = executor.buildUrl(model, true, 0, connection);
  const response = await fetchFn(url, {
    method: "POST",
    headers: executor.buildHeaders(connection, true, url, model, body),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CODEBUDDY_PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  const fallback = `CodeBuddy returned HTTP ${response.status}`;
  let data;
  try { data = JSON.parse(text); } catch { /* SSE is handled below. */ }
  if (!response.ok || data?.error || (data?.code != null && data.code !== 0)) {
    return { valid: false, error: providerError(data, fallback) };
  }

  let hasCompletion = Array.isArray(data?.choices);
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event.error || (event.code != null && event.code !== 0)) {
        return { valid: false, error: providerError(event, "CodeBuddy stream returned an error") };
      }
      if (Array.isArray(event.choices)) hasCompletion = true;
    } catch { /* Ignore non-JSON keepalive events. */ }
  }
  return hasCompletion
    ? { valid: true, error: null }
    : { valid: false, error: "CodeBuddy returned no chat completion" };
}
