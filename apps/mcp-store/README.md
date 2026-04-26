# `@lucidindex/mcp-store`

The mcp-store sidecar — LucidIndex's **agent surface**.

This Node service is the only entrypoint Claude (and other MCP clients) use
to pull queue items, write articles, and read topic metadata. It runs as a
separate container from the Next.js web app and shares the Postgres
database via [`@lucidindex/db`](../../packages/db).

## Status

Real MCP server as of Phase 3 #39+#40+#41:

- **Streamable HTTP transport** with `Authorization: Bearer <token>` auth
  (default; what docker-compose runs).
- **stdio transport** for process-local clients (`MCP_TRANSPORT=stdio`).
- **Five tools** registered: `pull_queue_item`, `ack_queue_item`,
  `write_articles`, `get_topic_badges`, `get_high_water_mark`.
- **Pre-admin guard** — every tool returns `no_admin_enrolled` until at
  least one row exists in `admins`.

Deeper behavior lands in subsequent tickets — see TODO markers in
`src/tools/*.ts`:

| Ticket | Adds                                                                    |
| ------ | ----------------------------------------------------------------------- |
| #42    | `pull_queue_item` atomic claim-lock with `FOR UPDATE SKIP LOCKED`       |
| #43    | `write_articles` topic-badge validation + suggestion inbox + dedup      |
| #44    | Liquid template rendering at queue-pull time                            |
| #45    | Hero image fetch + sharp pipeline                                       |
| #47    | Vitest test suite for the sidecar                                       |

## Transports

### Streamable HTTP (default)

Mounted on `MCP_PORT` (default `4000`). Every request must carry
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

Switch with `MCP_TRANSPORT=stdio`. Bypasses bearer-auth (process-local
trust). Suitable for co-located agents that exec into the container or
local-dev sessions with the MCP inspector. The pre-admin guard still
applies.

## Tools

All tool error responses use `isError: true` with a structured
`{ error: { code, message } }` payload that callers can branch on.

| Tool                  | Input                                                                                       | Output                                                                                                | Notes                                              |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `pull_queue_item`     | none                                                                                        | claim payload + rendered prompt, or `{ queue_item_id: null }` if empty                                | TODO(#42) atomic claim-lock; TODO(#44) Liquid render |
| `ack_queue_item`      | `{ queue_item_id, status, failure_reason?, new_high_water_mark? }`                          | `{ ok: true }`                                                                                        | Promotes the interim run_log row, updates target   |
| `write_articles`      | `{ queue_item_id, articles[] }`                                                             | `{ accepted, ids[] }`                                                                                 | TODO(#43) badge validation + dedup; TODO(#45) image |
| `get_topic_badges`    | none                                                                                        | `{ badges: { name, color, display_order }[] }`                                                        | Read-only                                          |
| `get_high_water_mark` | `{ target_id }`                                                                             | `{ high_water_mark }`                                                                                 | Errors `target_not_found` if id unknown            |

Auth context (the authenticated `agent_token_id`) is plumbed via the SDK's
`RequestHandlerExtra.authInfo.extra`. Tools that write rows tagged with
`agent_token_id` (`ack_queue_item`, `write_articles`) require the HTTP
transport — they refuse with `unauthenticated` over stdio.

## Run locally

From the repo root:

```sh
# install once
pnpm install

# dev mode — tsx watch, hot reload on src/ changes
pnpm --filter @lucidindex/mcp-store dev

# stdio mode (for the MCP inspector or co-located agents)
MCP_TRANSPORT=stdio pnpm --filter @lucidindex/mcp-store dev
```

## Run via docker-compose

```sh
docker compose up -d --build mcp-store
curl http://127.0.0.1:4000/healthz
# => {"status":"ok"}
```

## Manual smoke

```sh
# 1. Spin up Postgres + apply migrations + seed prompt templates.
docker run --rm -d --name li-mcp-test -p 5450:5432 \
  -e POSTGRES_USER=lucidindex -e POSTGRES_PASSWORD=lucidindex_dev \
  -e POSTGRES_DB=lucidindex postgres:16-alpine
sleep 4
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5450/lucidindex pnpm db:migrate
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5450/lucidindex pnpm db:seed

# 2. Boot the sidecar (HTTP).
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5450/lucidindex \
  MCP_PORT=4001 \
  pnpm --filter @lucidindex/mcp-store dev &

# 3. Pre-admin guard fires (no admin rows yet → no_admin_enrolled).
#    Note: any token-shaped value works here; the guard runs after auth, but
#    you'll see no_admin_enrolled before any tool body executes.
docker exec li-mcp-test psql -U lucidindex -d lucidindex \
  -c "INSERT INTO agent_tokens (label, token_hash) VALUES ('smoke', '$argon2id\$...');"

# (Skip ahead — easier path: insert a fake admin and exercise the happy path.)
docker exec li-mcp-test psql -U lucidindex -d lucidindex \
  -c "INSERT INTO admins (name) VALUES ('TestAdmin');"

# Generate a token + argon2 hash.
cd apps/mcp-store
node -e "
  const argon2 = require('@node-rs/argon2');
  const tok = require('node:crypto').randomBytes(32).toString('base64url');
  argon2.hash(tok).then(h => { console.log('TOKEN=' + tok); console.log('HASH=' + h); });
"
# => TOKEN=<cleartext>
# => HASH=<argon2id$...>

# Insert the agent_token row using the hash.
docker exec li-mcp-test psql -U lucidindex -d lucidindex \
  -c "INSERT INTO agent_tokens (label, token_hash) VALUES ('smoke', \$\$<HASH>\$\$);"

# 4. Call get_topic_badges — should succeed.
curl -sS -X POST http://localhost:4001/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_topic_badges","arguments":{}}}'

# 5. Call without bearer — should 401.
curl -i -sS -X POST http://localhost:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 6. Tear down.
docker stop li-mcp-test
```

## Environment variables

| Var                      | Required | Default      | Notes                                                                                |
| ------------------------ | -------- | ------------ | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`           | yes      | —            | Shared with `apps/web`. Same Postgres, same schema.                                  |
| `MCP_PORT`               | no       | `4000`       | Listen port (HTTP transport only). Bound to `127.0.0.1` in docker-compose.           |
| `MCP_TRANSPORT`          | no       | `http`       | `http` (Streamable HTTP) or `stdio`.                                                 |
| `MCP_QUEUE_LOCK_TTL_SEC` | no       | `900`        | Claim-lock TTL for `pull_queue_item`. TODO(#42) makes claim-locking atomic.          |
| `NODE_ENV`               | no       | `production` | Standard Node env flag.                                                              |

## Logging

Structured JSON, one object per line, on stdout (`debug`/`info`/`warn`) or
stderr (`error`). See [`src/logger.ts`](src/logger.ts).

In stdio transport mode, **all** levels are redirected to stderr so the
JSON-RPC stream on stdout stays clean.

> **Never log secrets.** Reference rows by their database id (e.g.
> `agent_tokens.id`) instead of the cleartext token.
