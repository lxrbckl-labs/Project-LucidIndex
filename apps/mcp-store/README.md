# `@lucidindex/mcp-store`

The mcp-store sidecar — LucidIndex's **agent surface**.

This Node service is the only entrypoint Claude (and other MCP clients) use
to pull queue items, write articles, and read topic metadata. It runs as a
separate container from the Next.js web app and shares the Postgres
database via [`@lucidindex/db`](../../packages/db).

## Status

This package is a **scaffold** as of ticket #38. It boots a placeholder HTTP
server on `MCP_PORT` so the docker-compose stack can verify the sidecar
starts and stays up. The real wiring lands in subsequent Phase 3 tickets:

| Ticket | Adds                                                                     |
| ------ | ------------------------------------------------------------------------ |
| #39    | Streamable HTTP + stdio MCP transports                                   |
| #40    | MCP tools (`pull_queue_item`, `ack_queue_item`, `write_articles`, etc.)  |
| #41    | Pre-admin guard middleware                                               |
| #42    | Claim-lock implementation on `pull_queue_item`                           |
| #43    | `write_articles` validation + dedup                                      |
| #44    | Liquid template rendering at queue-pull time                             |
| #45    | Hero image fetch + sharp pipeline                                        |
| #47    | Vitest test suite for the sidecar                                        |

## Run locally

From the repo root:

```sh
# install once
pnpm install

# dev mode — tsx watch, hot reload on src/ changes
pnpm --filter @lucidindex/mcp-store dev

# or: build + run the compiled output
pnpm --filter @lucidindex/mcp-store build
pnpm --filter @lucidindex/mcp-store start
```

Then:

```sh
curl http://localhost:4000/
# => {"status":"mcp-store scaffold","message":"transports + tools land in #39 + #40"}
```

## Run via docker-compose

```sh
docker compose up -d --build mcp-store
curl http://127.0.0.1:4000/
```

## Environment variables

| Var            | Required | Default        | Notes                                                |
| -------------- | -------- | -------------- | ---------------------------------------------------- |
| `DATABASE_URL` | yes      | —              | Shared with `apps/web`. Same Postgres, same schema.  |
| `MCP_PORT`     | no       | `4000`         | Listen port. Bound to `127.0.0.1` in docker-compose. |
| `NODE_ENV`     | no       | `production`   | Standard Node env flag.                              |

## Logging

Structured JSON, one object per line, on stdout (`debug`/`info`/`warn`) or
stderr (`error`). See [`src/logger.ts`](src/logger.ts).

> **Never log secrets.** Reference rows by their database id (e.g.
> `agent_tokens.id`) instead of the cleartext token.
