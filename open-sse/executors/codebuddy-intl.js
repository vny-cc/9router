import { CodeBuddyExecutor } from "./codebuddy-cn.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Shares channel verification, request normalization, error parsing, and OAuth
 * refresh behavior with CodeBuddyExecutor while using the international provider.
 */
export class CodeBuddyIntlExecutor extends CodeBuddyExecutor {
  constructor() {
    super("codebuddy-intl");
  }
}

export default CodeBuddyIntlExecutor;
