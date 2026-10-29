// CodeBuddy CLI channel contract used by the CN and international gateways.
export const CODEBUDDY_CLI_VERSION = "2.108.1";
export const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";
export const CODEBUDDY_EXTERNAL_IDENTITY = "[external-client-identity]";
export const CODEBUDDY_PROBE_TIMEOUT_MS = 15000;
export const CODEBUDDY_PROBE_PROMPT = "Say OK.";
export const CODEBUDDY_PROBE_MAX_TOKENS = 1;
export const CODEBUDDY_PROVIDER_NAMES = ["codebuddy-cn", "codebuddy-intl", "cbcn", "cbai"];
export const CODEBUDDY_ACCOUNT_RESTRICTION = {
  upstreamCode: 11140,
  type: "permission_error",
  code: "account_restricted",
  codePattern: /"code"\s*:\s*11140\b|\bcode\s+11140\b/i,
  message: "CodeBuddy has restricted this account (code 11140). Check the account in the official CodeBuddy client and submit feedback to appeal the restriction.",
  markers: ["account has been restricted", "account restricted", "账号存在异常行为", "帳號存在異常行為"],
};

export const CODEBUDDY_CHANNEL_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
  "X-Product": "SaaS",
  "X-App": "cli",
  "X-IDE-Type": "CLI",
  "X-IDE-Name": "CLI",
  "X-IDE-Version": CODEBUDDY_CLI_VERSION,
  "X-Private-Data": "false",
  "X-Requested-With": "XMLHttpRequest",
  "X-CodeBuddy-Request": "1",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": "x64",
  "X-Stainless-Os": "Windows",
  "X-Stainless-Package-Version": "6.25.0",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Agent-Intent": "craft",
  "X-Agent-Purpose": "conversation",
};

export const CODEBUDDY_CHANNEL_MARKERS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",
  "x-anthropic-billing-header",
  "Main branch (you will usually use this for PRs):",
];

export const CODEBUDDY_CHANNEL_MARKER_REGEX =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode/gi;
