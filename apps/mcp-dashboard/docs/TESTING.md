# mcp-dashboard — testing setup

## Integration tests

Most `*.test.ts` files in `src/tools/` and `src/transports/` are
integration tests that need a live Postgres. The harness lives in
`packages/db/test-helpers.ts`:

- `makeTestDb()` — opens a postgres-js / drizzle handle.
- `resolveTestDatabaseUrl()` — `DATABASE_URL_TEST` if set, else
  `DATABASE_URL` with the database name swapped to `lucidindex_test`.
- `truncateAllTables(db)` — `TRUNCATE ... RESTART IDENTITY CASCADE`
  across every user table; call in `beforeEach`.

See `apps/mcp-dashboard/src/tools/check-article-exists.test.ts` for
the canonical bootstrap shape (the one un-skipped file as of round 9).

### One-time setup

You need a separate `lucidindex_test` database on the same Postgres
instance as `DATABASE_URL` (or a separately-provisioned instance, if
you set `DATABASE_URL_TEST`).

#### Local (docker-compose dev stack)

```bash
docker compose up -d postgres
docker compose exec postgres psql -U lucidindex -d postgres \
  -c "CREATE DATABASE lucidindex_test;"

DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5432/lucidindex_test \
  pnpm --filter @lucidindex/db db:migrate
```

After that, every `pnpm --filter @lucidindex/mcp-dashboard test` run
will pick up the test DB via `resolveTestDatabaseUrl()` even without
`DATABASE_URL_TEST` set (the helper falls back to `DATABASE_URL` with
the database name swapped).

#### CI

Set `DATABASE_URL_TEST` to the ephemeral DB the runner provisions and
re-run the second command above as a setup step.

### Suite behavior without a test DB

Files using `describeIfDb` (the `HAS_TEST_DB ? describe : describe.skip`
pattern in `check-article-exists.test.ts`) automatically skip the
entire suite when neither `DATABASE_URL_TEST` nor `DATABASE_URL` is
reachable, so `pnpm test` doesn't fail in CI environments that lack
the DB. The skip is silent — check the test reporter for SKIPPED
counts if you expect coverage.

### Per-test isolation

`truncateAllTables(db)` in `beforeEach` is the simplest pattern. It's
fast (under 50ms even on a hot pool) and bullet-proof — every test
sees an empty DB. Don't try to share fixtures across tests; the
isolation is worth the small repeated-insert cost.

## Currently skipped files

As of round 9, four `*.test.ts` files remain `.skip` (down from the
five-ish that existed before the harness landed):

- `src/tools/write-target-profile.test.ts`
- `src/tools/get-queue-stats.test.ts`
- `src/tools/write-articles.test.ts`
- `src/transports/http.test.ts`

The harness is no longer the blocker — each file's header now points
at `check-article-exists.test.ts` as the pattern to copy. `write-articles`
is the heaviest lift (deep transactional path; lots of seed data); the
others should each be a half-hour port.
