# Claude streaming cache accounting repair

Claude-to-OpenAI translation already includes cache read/write tokens in
`prompt_tokens`, but retained only Claude-native cache fields. Storage interpreted
that shape as cache-exclusive and added the cache a second time. The inflated
remainder was then priced as fresh input. This also affected Claude-to-Responses
traffic, which pivots through OpenAI.

The translator now sets `cached_tokens` (including zero for first cache writes)
alongside its inclusive prompt. The storage canonicalizer recognizes that shape
and preserves the input count. Native Claude passthrough still folds cache once.

Source: `open-sse/translator/response/claude-to-openai.js`.
Regression coverage: `tests/unit/claude-stream-cache-accounting.test.js`.

Validation: 46 tests in six files passed, including cache usage/cost, persistence,
Claude thinking/refusal, and streaming to Chat Completions and Responses. ESLint
and `git diff --check` passed. The built-image smoke script uses a disposable
container and synthetic upstream, checking all three client formats and SQLite
usage/cost. The original image reproduces 1,394,734 stored tokens instead of
697,368 for the cache-read case.

Deployment status: the local build was canceled at the user's request to avoid
loading the production server. The patch has not been deployed, production has
not been restarted, and the production database has not been repaired. The
patched image smoke test is still pending. The repair script was successfully
tested on a backup copy, including a second invocation proving idempotency.

Build this branch on a separate machine:

```sh
git clone --branch fix/claude-stream-cache-accounting https://github.com/vny-cc/9router.git
cd 9router
docker build --build-arg APP_VERSION=0.5.112-cachefix-20261031 \
  -t 9router-local:0.5.112-cachefix-20261031 .
docker save -o 9router-cachefix-20261031.tar 9router-local:0.5.112-cachefix-20261031
```

The patch is based on Git HEAD `e564d2c`, preserving the production baseline and
excluding unrelated staged changes. The old container's entire `open-sse` tree
was compared with that context; only the intended translator file differs.

Run the synthetic smoke test on the build machine before transferring the image:

```sh
docker run -d --name 9router-cachefix-check \
  --label local.9router.canary=cachefix \
  -p 127.0.0.1:20129:20128 \
  -e INITIAL_PASSWORD=cachefix-smoke-password \
  -e DATA_DIR=/app/data -e PORT=20128 -e HOSTNAME=0.0.0.0 \
  9router-local:0.5.112-cachefix-20261031
# Wait for the container to start, then run with Node.js 22 or newer on the host.
node scripts/smoke-claude-cache-accounting.mjs
docker rm -f 9router-cachefix-check
```

The smoke script expects a Linux Docker bridge gateway reachable from the host.
It uses disposable data and synthetic credentials/upstream responses.

Backup and build/smoke logs:
`/home/ubuntu/backups/9router-cache-fix-20261031/`.
Stack: `/opt/stacks/9router/compose.yaml`.

`scripts/repair-claude-cache-20261031.py` repairs only the 20 verified records
between 13:12 and 13:19 UTC for the affected Claude API connection. Dry-run is
the default. Apply while the server is stopped, supplying a new `--backup` path.
It validates pricing and token invariants, updates history and all five daily
aggregate breakdowns atomically, and stores an idempotency marker and original
values for audit. Request counts, output and cache counters are preserved.

For these records, input changes from 23,823,295 to 11,912,023 tokens, and local
estimated cost from $56.6759672 to $9.0308792 at the configured pricing rates.
This corrects local statistics; it does not alter provider billing or the large
conversation sent by the client. Headroom behavior/configuration is unchanged.

Rollback the application by restoring `compose-before.yaml` from the backup
directory to the stack and running `docker compose up -d --no-deps --pull never
9router`. The pre-repair SQLite backup is retained separately; stop the server
before restoring a database, and account for any requests recorded since backup.
