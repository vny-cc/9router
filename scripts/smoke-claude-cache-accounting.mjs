import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

const container = process.argv[2] || "9router-cachefix-check";
const base = process.argv[3] || "http://127.0.0.1:20129";
const inspect = JSON.parse(execFileSync("docker", ["inspect", container]))[0];
assert.equal(inspect.Config.Labels["local.9router.canary"], "cachefix");
assert.ok(!inspect.Mounts.some(m => m.Destination === "/app/data"));
const gateway = Object.values(inspect.NetworkSettings.Networks)[0].Gateway;
let calls = 0;
const upstream = createServer(async (req, res) => {
  for await (const _chunk of req) { /* Drain synthetic request. */ }
  calls++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  const events = [
    { type: "message_start", message: { id: "msg_smoke", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: {
      input_tokens: 2, cache_read_input_tokens: 696890, cache_creation_input_tokens: 476, output_tokens: 0,
    } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 214 } },
    { type: "message_stop" },
  ];
  res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
});
await new Promise(resolve => upstream.listen(0, gateway, resolve));
const run = code => execFileSync("docker", ["exec", container, "node", "-e", code], { encoding: "utf8" });
try {
  const init = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "cachefix-smoke-password" }) });
  assert.equal(init.status, 200, await init.text());
  const nodeData = JSON.stringify({ prefix: "cachecheck", baseUrl: `http://${gateway}:${upstream.address().port}/v1` });
  const connectionData = JSON.stringify({ apiKey: "synthetic-upstream-key", testStatus: "active", providerSpecificData: { baseUrl: `http://${gateway}:${upstream.address().port}/v1` } });
  run(`const db=new(require('better-sqlite3'))('/app/data/db/data.sqlite'); const now=new Date().toISOString();
    db.prepare('INSERT INTO providerNodes(id,type,name,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('anthropic-compatible-cachecheck','anthropic-compatible','Smoke',${JSON.stringify(nodeData)},now,now);
    db.prepare('INSERT INTO providerConnections(id,provider,authType,name,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,1,?,?,?)').run('cachecheck','anthropic-compatible-cachecheck','apikey','Smoke',${JSON.stringify(connectionData)},now,now);
    db.prepare('INSERT INTO apiKeys(id,key,isActive,createdAt,accessRestricted) VALUES(?,?,1,?,0)').run('smoke','synthetic-router-key',now);`);
  for (const endpoint of ["chat/completions", "responses", "messages"]) {
    const input = endpoint === "responses" ? { input: "Say OK." } : { messages: [{ role: "user", content: "Say OK." }] };
    const res = await fetch(`${base}/v1/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-router-key" },
      body: JSON.stringify({ model: "cachecheck/claude-opus-5-5", ...input, stream: true, max_tokens: 300 }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(res.status, 200, await res.clone().text());
    assert.match(await res.text(), /OK/);
    console.log(`PASS built API /v1/${endpoint}`);
  }
  // All response bodies have drained; the async usage persistence has settled
  // before querying through the server's own SQLite WAL connection.
  const rows = JSON.parse(run(`const db=new(require('better-sqlite3'))('/app/data/db/data.sqlite'); console.log(JSON.stringify(db.prepare('SELECT promptTokens,completionTokens,cost,tokens FROM usageHistory ORDER BY id').all()));`));
  assert.equal(calls, 3);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.promptTokens, 697368);
    assert.equal(row.completionTokens, 214);
    assert.equal(JSON.parse(row.tokens).cached_tokens, 696890);
    assert.ok(Math.abs(row.cost - 0.146046) < 1e-9, `Unexpected cost ${row.cost}`);
  }
  console.log("PASS persisted token counts and costs for all 3 client formats; no paid API calls");
} finally {
  await new Promise(resolve => upstream.close(resolve));
}
