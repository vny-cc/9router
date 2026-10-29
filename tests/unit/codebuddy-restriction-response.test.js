import { describe, expect, it } from "vitest";
import { codebuddyRestrictionResponse, isCodebuddyAccountRestriction } from "../../open-sse/utils/codebuddyError.js";

const restriction = '[403]: {"code":11140,"msg":"request illegal","requestId":"request-1","displayMsg":{"en":"Your account has been restricted due to unusual activity"}}';

describe("CodeBuddy restricted-account response", () => {
  it.each(["codebuddy-cn", "codebuddy-intl", "cbcn", "cbai"])("returns a non-retryable 403 for %s", async (provider) => {
    const response = codebuddyRestrictionResponse(provider, 403, restriction, { "Retry-After": "2", "x-should-retry": "true" });
    expect(response.status).toBe(403);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect((await response.json()).error).toMatchObject({ type: "permission_error", code: "account_restricted", upstream_code: 11140, request_id: "request-1" });
  });

  it("does not misclassify channel failures, quota errors, or other providers", () => {
    expect(codebuddyRestrictionResponse("codebuddy-intl", 400, '{"code":11128,"msg":"request illegal"}')).toBeNull();
    expect(codebuddyRestrictionResponse("codebuddy-intl", 403, '{"code":11140,"msg":"request illegal","displayMsg":{"en":"Model frequency limit exceeded"}}')).toBeNull();
    expect(codebuddyRestrictionResponse("openai", 403, restriction)).toBeNull();
    expect(codebuddyRestrictionResponse("codebuddy-intl", 503, restriction)).toBeNull();
  });

  it("recognizes a saved error truncated to the database's 200-character limit", () => {
    expect(isCodebuddyAccountRestriction("codebuddy-intl", 403, restriction.slice(0, 200))).toBe(true);
  });
});
