# `@lucidindex/mcp-dashboard`

The mcp-dashboard sidecar — LucidIndex's **agent surface for the dashboard
content pipeline**. (Paired with `apps/mcp-forum`, the separate sidecar
serving the forum surface.)

This Node service is the only entrypoint Claude (and other MCP clients) use
to pull queue items, write articles, and read topic metadata. It runs as a
separate container from the Next.js web app and shares the Postgres
database via [`@lucidindex/db`](../../packages/db).

## Status

Production-shaped MCP server. **16 tools** registered across four
categories:

- **Queue ops** — `pull_queue_item`, `ack_queue_item`, `extend_queue_lock`,
  `get_queue_stats`.
- **Write ops** — `write_articles` (the only mutation that creates
  article rows; includes badge validation, suggestion inbox, server-side
  URL canonicalization, per-article savepoints with partial-success
  responses, and the hero-image pipeline run outside the insert
  transaction).
- **Read / lookup ops** — `get_topic_badges`, `get_high_water_mark`,
  `get_comparison_sources`, `list_targets`, `search_articles`,
  `check_article_exists`, `list_my_recent_runs`.
- **Target-metadata writes (one-shot)** — `write_target_description`,
  `write_target_social_url`, `write_target_photo_url`,
  `write_target_profile` (combined one-call wrapper).

Each tool is wrapped in a pre-admin guard that returns
`no_admin_enrolled` until at least one row exists in `admins`.

For per-tool input shapes, returns, and error codes see the public
catalog at **[`/agents/dashboard`](/agents/dashboard)** (also linked
from the apps/web nav). The catalog is the canonical reference — this
README intentionally does not duplicate it.

### What's here

- **Streamable HTTP transport** with `Authorization: Bearer <token>` auth
  — the default and what docker-compose runs.
- **stdio transport** for process-local clients
  (`MCP_DASHBOARD_TRANSPORT=stdio`); bypasses auth.
- **Atomic claim-lock** on `pull_queue_item` — `FOR UPDATE SKIP LOCKED`
  makes concurrent pulls safe under contention.
- **Liquid render** at queue-pull time — `rendered_prompt` is the
  template body run through LiquidJS against the per-target context vars.
- **Topic-badge validation + suggestion inbox + silent dedup** in
  `write_articles` — strict mode rejects unknown badges; default mode
  routes them to `topic_badge_suggestions` and proceeds; repeat
  `(target_id, source_url)` returns the existing id with
  `deduped: true`.
- **Hero image pipeline** in `write_articles` — fetch + sharp resize +
  WebP/JPEG fallback under `data/images/<content-hash>.<ext>`; failure
  does not block the article write.
- **Source dedup primitives** — `check_article_exists` (O(1) exact
  source_url lookup) and `search_articles` with `include_suppressed`
  (deprecated alias: `include_hidden`) give agents a way to abort BEFORE
  researching a duplicate story.
- **Server-side URL canonicalization** — every `check_article_exists` and
  `write_articles` call runs the incoming `source_url` through
  `@lucidindex/shared/url`'s `normalizeSourceUrl` (lowercase host, strip
  default ports, strip fragment, drop `www.`, drop tracking params,
  alphabetize query params, strip trailing slash). Migration
  `0029_normalize_source_urls` backfilled existing rows. The dedup story
  is now robust to cosmetic URL variations across the corpus.

## Transports

### Streamable HTTP (default)

Mounted on `MCP_DASHBOARD_PORT` (default `4000`). Every request must carry
`Authorization: Bearer <token>` where `<token>` is a cleartext agent token
issued via the apps/web Settings → Agent Tokens flow (#35). Tokens are
hashed with argon2id at rest in `agent_tokens.token_hash`; the cleartext
is shown ONCE at creation and never persisted.

The transport runs in **stateless mode** — no server-side session id is
generated and each request is handled independently. The MCP `initialize`
handshake is therefore optional for clients that just want to call tools.

A `GET /healthz` endpoint bypasses auth and the MCP framing — useful for
docker-compose healthchecks.

### stdio

Switch with `MCP_DASHBOARD_TRANSPORT=stdio`. Bypasses bearer-auth (process-local
trust). Suitable for co-located agents that exec into the container or
local-dev sessions with the MCP inspector. The pre-admin guard still
applies.

## Tools

All tool error responses use `isError: true` with a structured
`{ error: { code, message } }` payload that callers can branch on.

The canonical per-tool reference (input shapes, returns, error codes)
lives at **[`/agents/dashboard`](/agents/dashboard)**. This README
intentionally does not enumerate the 16 tools — the catalog is generated
from the same `registerTool({ description })` strings and is what agents
read.

Auth context (the authenticated `agent_token_id`) is plumbed via the SDK's
`RequestHandlerExtra.authInfo.extra`. Tools that write rows tagged with
`agent_token_id` (`ack_queue_item`, `write_articles`, `extend_queue_lock`)
require the HTTP transport — they refuse with `unauthenticated` over
stdio. All read-only tools (including `check_article_exists` and
`search_articles`) work on either transport.

### Atomic claim-lock (#42) — design notes

`pull_queue_item` uses a single `UPDATE ... WHERE id = (SELECT ... FOR
UPDATE SKIP LOCKED) RETURNING *` statement. drizzle-orm 0.45.x doesn't
expose `FOR UPDATE SKIP LOCKED` ergonomically, so the implementation
drops to raw SQL via `db.execute(sql\`...\`)`. The interval expression
uses `make_interval(secs => $1)` because Postgres won't bind a parameter
inside an `interval '<literal>'` literal.

Two concurrent pullers either pick different rows or one returns `null`
(queue empty after the other claimed it). No double-claims possible.
Verified manually with 10 parallel `pull_queue_item` calls against a
single queued row — exactly one claim returned the row, nine returned
`{ queue_item_id: null }`.

### Lock TTL

Configurable via `MCP_DASHBOARD_LOCK_TTL_MINUTES` (preferred, per #42 spec) or the
legacy `MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC`. Default 15 minutes.

### Topic-badge validation + dedup (#43) — design notes

- **Default mode** (`settings.strict_mode = false`): unknown badges
  proceed; each is upserted into `topic_badge_suggestions` with
  `count++` on revisit (`ON CONFLICT (name) DO UPDATE`). Suggestions are
  attributed to the first article in the batch that referenced the
  badge.
- **Strict mode** (`settings.strict_mode = true`): the entire
  `write_articles` call is rejected with `unknown_topic_badge` and the
  list of offending badges.
- **Dedup** is now silent: repeat `(target_id, source_url)` returns the
  existing article id with `deduped: true`. The DB UNIQUE constraint
  stays as a last-resort safety net for racy concurrent inserts.
- **Response shape:** `{ accepted: number, results: { id, deduped: boolean }[] }`.

### Run-log timing change (#43)

`articles.run_log_id` is non-null FK, so the run_log row must exist
before any article inserts. Before this PR, `ack_queue_item` created the
run_log row and `write_articles` raced ahead with a sentinel "interim"
row that ack promoted.

After this PR: `write_articles` is the authoritative creator of the
run_log row (status='succeeded' on creation, articles_count incremented
as articles land). `ack_queue_item` updates the existing row's terminal
status and recomputes `articles_count` from actual article rows. If
`write_articles` never ran (failed pass), `ack_queue_item` falls back to
inserting a fresh terminal row with `articles_count = 0`.

### Hero image pipeline (#45) — design notes

`hero_image_url` is **required** on every article (it must be a URL for an
image clearly related to the story — see
[`docs/editorial-image-policy.md`](../../docs/editorial-image-policy.md)).
Presence is enforced by the input schema; the fetch/store below is
best-effort and a fetch failure stays non-fatal.

When an article is written with its `hero_image_url`:

1. `fetch(url)` with a 10s timeout and a 25 MB body cap (both
   configurable via env). Stream is aborted on overrun.
2. `sharp()` resizes to max 1600 px wide (configurable via
   `MCP_IMAGE_MAX_WIDTH`), strips EXIF, autorotates via metadata.
3. Encodes TWICE — WebP (quality 82) and JPEG (mozjpeg, quality 82).
4. **Filename = sha-256 hex of the WebP bytes.** We hash the WebP rather
   than the source bytes so that two equivalent JPEG uploads at slightly
   different qualities don't collide on disk; our processed output is
   the unit of dedup. Only the hash is stored in the DB
   (`articles.hero_image_hash`); the image-serve route handler in Phase
   7 #74 picks the right extension off the request's `Accept` header.
5. Writes both files to `<MCP_IMAGE_DIR>/<hash>.webp` and `<hash>.jpg`.

**Failure path:** ANY error — fetch error, timeout, oversize, decode
error, write error — logs a structured warning and returns
`hero_image_hash = null`. The article still inserts. The dashboard
renders a placeholder tile.

`sharp` ships pre-compiled `linuxmusl-x64`/`linuxmusl-arm64` binaries via
optionalDependencies; the Alpine Dockerfile picks them up automatically.
No install scripts needed (sharp 0.33+ dropped that requirement).

## Run locally

From the repo root:

```sh
# install once
pnpm install

# dev mode — tsx watch, hot reload on src/ changes
pnpm --filter @lucidindex/mcp-dashboard dev

# stdio mode (for the MCP inspector or co-located agents)
MCP_DASHBOARD_TRANSPORT=stdio pnpm --filter @lucidindex/mcp-dashboard dev
```

## Run via docker-compose

```sh
docker compose up -d --build mcp-dashboard
curl http://127.0.0.1:4000/healthz
# => {"status":"ok"}
```

## Manual smoke (post-#42/#43/#44/#45)

```sh
# 1. Postgres + migrations + seed.
docker run --rm -d --name li-mcp-deep -p 5453:5432 \
  -e POSTGRES_USER=lucidindex -e POSTGRES_PASSWORD=lucidindex_dev \
  -e POSTGRES_DB=lucidindex postgres:16-alpine
sleep 4
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5453/lucidindex pnpm db:migrate
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5453/lucidindex pnpm db:seed   # 7 templates

# 2. Seed admin + topic badges + a target + a queue row.
docker exec li-mcp-deep psql -U lucidindex -d lucidindex \
  -c "INSERT INTO admins (name) VALUES ('TestAdmin');
      INSERT INTO topic_badges (name) VALUES ('AI'), ('Astronomy');
      INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, high_water_mark)
        VALUES ('TestTarget', 'https://example.com', 'hourly',
                (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1), now(),
                '\"2026-04-25T00:00:00Z\"'::jsonb);
      INSERT INTO queue (target_id) VALUES ((SELECT id FROM targets LIMIT 1));"

# 3. Mint an agent token and insert its argon2 hash.
cd apps/mcp-dashboard
node --input-type=module -e "
  import { hash } from '@node-rs/argon2';
  import crypto from 'node:crypto';
  const tok = crypto.randomBytes(32).toString('base64url');
  const h = await hash(tok);
  console.log('TOKEN=' + tok); console.log('HASH=' + h);
"
# => TOKEN=<cleartext>
# => HASH=<argon2id$...>
docker exec li-mcp-deep psql -U lucidindex -d lucidindex \
  -c "INSERT INTO agent_tokens (label, token_hash) VALUES ('test-agent', '<HASH>');"

# 4. Boot the sidecar.
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5453/lucidindex \
  MCP_DASHBOARD_PORT=4503 MCP_DASHBOARD_TRANSPORT=http \
  pnpm --filter @lucidindex/mcp-dashboard dev > /tmp/qa-deep.log 2>&1 &
sleep 5

TOKEN=<cleartext>

# 5. pull_queue_item — verify rendered_prompt has Liquid substitutions
#    (TestTarget, https://example.com, the high_water_mark, hourly, 3).
curl -sS -X POST http://localhost:4503/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pull_queue_item","arguments":{}}}'

# 6. write_articles with a known badge — succeeds, deduped:false.
curl -sS -X POST http://localhost:4503/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"write_articles","arguments":{"queue_item_id":"<QID>","articles":[{"source_url":"https://example.com/p1","title":"t","summary":"s","topic_badges":["AI"],"significance":"medium","difficulty":"easy"}]}}}'

# 7. write_articles same source_url again — deduped:true with the same id.
# 8. write_articles with an unknown badge in default mode — succeeds AND
#    creates a topic_badge_suggestions row (count=1).
# 9. Repeat the same unknown badge — count goes to 2.
# 10. Set strict_mode and try unknown badge — rejected with unknown_topic_badge.
docker exec li-mcp-deep psql -U lucidindex -d lucidindex \
  -c "INSERT INTO settings (id, strict_mode) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET strict_mode = true;"

# 11. Image pipeline happy path — picsum delivers a real image.
#     Verify data/images/<hash>.webp + .jpg exist; articles.hero_image_hash is set.
curl -sS -X POST http://localhost:4503/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"write_articles","arguments":{"queue_item_id":"<QID>","articles":[{"source_url":"https://example.com/img","title":"t","summary":"s","topic_badges":["AI"],"significance":"medium","difficulty":"easy","hero_image_url":"https://picsum.photos/1200/800"}]}}}'
ls -la apps/mcp-dashboard/data/images/

# 12. Image pipeline failure path — 404 URL.
#     Article still inserts; hero_image_hash = null; structured warn log.

# 13. Concurrent claim-lock test — reset the queue row's lock and fire
#     10 parallel pulls. Exactly one should win, nine return null.
docker exec li-mcp-deep psql -U lucidindex -d lucidindex \
  -c "UPDATE queue SET locked_until = NULL, claimed_by = NULL WHERE acked_at IS NULL;"
for i in $(seq 1 10); do
  curl -sS -X POST http://localhost:4503/mcp \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/call","params":{"name":"pull_queue_item","arguments":{}}}' &
done
wait

# 14. ack_queue_item — verify run_log articles_count matches actual rows
#     and high_water_mark gets bumped.

# 15. Cleanup.
docker stop li-mcp-deep
```

## Environment variables

| Var                                | Required | Default       | Notes                                                                          |
| ---------------------------------- | -------- | ------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                     | yes      | —             | Shared with `apps/web`. Same Postgres, same schema.                            |
| `MCP_DASHBOARD_PORT`               | no       | `4000`        | Listen port (HTTP transport only). Bound to `127.0.0.1` in docker-compose.     |
| `MCP_DASHBOARD_TRANSPORT`          | no       | `http`        | `http` (Streamable HTTP) or `stdio`.                                           |
| `MCP_DASHBOARD_CORS_ORIGINS`       | no       | `*`           | Comma-separated allowlist for the `Access-Control-Allow-Origin` header, or `*` for any origin. |
| `MCP_DASHBOARD_LOCK_TTL_MINUTES`   | no       | `15`          | Claim-lock TTL for `pull_queue_item`. Wins over `MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC`. |
| `MCP_DASHBOARD_QUEUE_LOCK_TTL_SEC` | no       | —             | Legacy seconds-form of the lock TTL. Kept for back-compat.                     |
| `MCP_IMAGE_DIR`                    | no       | `data/images` | Shared with apps/web + apps/cron. Where the hero-image pipeline writes WebP+JPEG outputs. |
| `MCP_IMAGE_FETCH_TIMEOUT_MS`       | no       | `10000`       | Hero-image fetch budget (abort-on-timeout).                                    |
| `MCP_IMAGE_MAX_BYTES`              | no       | `26214400`    | Hero-image fetch byte cap (abort-on-overrun). 25 MB default.                   |
| `MCP_IMAGE_MAX_WIDTH`              | no       | `1600`        | Hero-image resize target. Wider images are scaled down; narrower pass through. |
| `NODE_ENV`                         | no       | `production`  | Standard Node env flag.                                                        |

> **`MCP_IMAGE_*` are intentionally NOT namespaced.** They describe the on-disk
> image store shared by apps/mcp-dashboard (writer), apps/web (image-serve
> route reader), apps/cron (retention purge + local backup reader), and the
> demo seeder (writer). All four point at the same volume and same
> content-hash layout, so one name keeps them in lock-step.

## Logging

Structured JSON, one object per line, on stdout (`debug`/`info`/`warn`) or
stderr (`error`). See [`src/logger.ts`](src/logger.ts).

In stdio transport mode, **all** levels are redirected to stderr so the
JSON-RPC stream on stdout stays clean.

> **Never log secrets.** Reference rows by their database id (e.g.
> `agent_tokens.id`) instead of the cleartext token.
