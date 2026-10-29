import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

const container = process.argv[2] || "9router-pr5032-check";
const baseUrl = process.argv[3] || "http://127.0.0.1:20129";
const canaryPassword = "pr5032-smoke-password";
const inspect = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0];
assert.equal(inspect.Config.Labels?.["local.9router.canary"], "pr5032", "Use only the disposable canary container");
assert.ok(inspect.Config.Env.includes(`INITIAL_PASSWORD=${canaryPassword}`), "Set the disposable canary password");
assert.ok(!inspect.Mounts.some((mount) => mount.Destination === "/app/data"), "Canary must use disposable data");
const gateway = Object.values(inspect.NetworkSettings.Networks)[0].Gateway;
let checkInstructions = true;
let restricted = false;
let upstreamCalls = 0;
const failures = [];

const upstream = createServer(async (request, response) => {
  try {
    let input = "";
    for await (const chunk of request) input += chunk;
    const body = JSON.parse(input);
    assert.equal(request.headers["x-relay-target"], "https://www.codebuddy.ai");
    assert.equal(request.headers["x-relay-path"], "/v2/chat/completions");
    assert.equal(request.headers.authorization, "Bearer smoke-upstream-token");
    assert.equal(request.headers["x-app"], "cli");
    assert.equal(request.headers["x-domain"], "www.codebuddy.ai");
    assert.match(request.headers["x-request-id"], /^[0-9a-f]{32}$/);
    assert.ok(request.headers["x-conversation-request-id"]);
    assert.equal(body.stream, true);
    assert.match(body.messages[0].content, /^You are CodeBuddy Code\./);
    if (checkInstructions) {
      assert.ok(body.messages[0].content.includes("Keep project rules."));
      assert.ok(body.messages[0].content.includes("Reply exactly OK."));
      assert.ok(!body.messages[0].content.includes("You are Claude Code"));
    }
    upstreamCalls++;
    if (restricted) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 11140, msg: "request illegal", displayMsg: { en: "Account restricted" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = { id: "smoke-completion", object: "chat.completion.chunk", created: 1, model: body.model };
    response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    failures.push(error.message);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Smoke upstream assertion failed" } }));
  }
});
await new Promise((resolve) => upstream.listen(0, gateway, resolve));

try {
  const relayUrl = `http://${gateway}:${upstream.address().port}`;
  const connectionData = { apiKey: "smoke-upstream-token", testStatus: "active", providerSpecificData: { proxyPoolId: "smoke-relay" } };
  const seed = `
    const Database = require("better-sqlite3");
    const db = new Database("/app/data/db/data.sqlite");
    const now = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES(?,1,?,?,?)").run("smoke-relay", ${JSON.stringify(JSON.stringify({ type: "vercel", proxyUrl: relayUrl, strictProxy: true }))}, now, now);
    db.prepare("INSERT OR REPLACE INTO providerConnections(id,provider,authType,name,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,1,?,?,?)").run("pr5032-smoke","codebuddy-intl","apikey","Smoke",${JSON.stringify(JSON.stringify(connectionData))},now,now);
    db.prepare("INSERT OR REPLACE INTO apiKeys(id,key,isActive,createdAt,accessRestricted) VALUES(?,?,1,?,0)").run("smoke-key","smoke-router-token",now);
  `;
  // Initialize the ephemeral database through the built application first.
  const initialized = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: canaryPassword }),
  });
  assert.equal(initialized.status, 200, await initialized.text());
  execFileSync("docker", ["exec", container, "node", "-e", seed]);
  const requestBody = {
    model: "cbai/glm-5.2",
    messages: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude.\nKeep project rules." },
      { role: "developer", content: "Reply exactly OK." },
      { role: "user", content: "Say OK." },
    ],
    max_tokens: 8,
  };
  for (const stream of [false, true]) {
    const result = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer smoke-router-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, stream }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(result.status, 200, await result.clone().text());
    if (stream) {
      const text = await result.text();
      assert.ok(text.includes("OK"));
      assert.ok(text.includes("[DONE]"));
    } else {
      assert.equal((await result.json()).choices[0].message.content, "OK");
    }
    console.log(`PASS built API: stream=${stream}, channel headers and caller instructions preserved`);
  }

  checkInstructions = false;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: canaryPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  for (const blocked of [false, true]) {
    restricted = blocked;
    const response = await fetch(`${baseUrl}/api/providers/pr5032-smoke/test`, { method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.valid, !blocked);
    if (blocked) assert.equal(result.error, "Account restricted (code 11140)");
    console.log(`PASS built dashboard Test: restricted=${blocked}, actual upstream result reported`);
  }
  const callsBeforeRestrictedChat = upstreamCalls;
  for (const stream of [false, true]) {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer smoke-router-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, stream }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-should-retry"), "false");
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal((await response.json()).error.code, "account_restricted");
    console.log(`PASS built restricted chat: stream=${stream}, 403 and retries disabled`);
  }
  assert.deepEqual(failures, []);
  assert.equal(upstreamCalls, callsBeforeRestrictedChat + 1, "Cached restriction must not contact upstream again");
} finally {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
