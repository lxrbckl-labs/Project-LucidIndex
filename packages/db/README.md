# `@lucidindex/db`

Drizzle schema + migrations for LucidIndex.

## Layout

```
schema/        Drizzle table definitions (one file per logical group)
migrations/    drizzle-kit-generated SQL — DO NOT hand-edit
client.ts      Singleton `db` instance + `makeClient(url)` factory
drizzle.config.ts
```

Migrations live in `migrations/` (Drizzle's default location). The Biome
config at the repo root ignores `drizzle/migrations/` — this package keeps
its migrations in `migrations/` so they aren't formatted; if Biome ever
starts reformatting them, extend the ignore list to cover `packages/db/migrations/`.

## Add a new schema

1. Create `schema/<group>.ts` and define your tables with `pgTable(...)`.
2. Re-export from `schema/index.ts`.
3. From the **repo root**:
   ```bash
   pnpm db:generate
   ```
   This writes a new `migrations/NNNN_<name>.sql` plus a snapshot under
   `migrations/meta/`. Commit both.

## Apply migrations

```bash
DATABASE_URL=postgres://lucidindex:lucidindex@localhost:5432/lucidindex \
  pnpm db:migrate
```

The first migration enables the `pgcrypto` extension so `gen_random_uuid()`
is available — every table here uses it for its primary key.

## Open Drizzle Studio

```bash
DATABASE_URL=... pnpm db:studio
```

## Use the client

```ts
import { db } from '@lucidindex/db/client'
import { admins, credentials, cronRuns } from '@lucidindex/db/schema'

const rows = await db.select().from(admins)
```

For tests / scripts that need a one-off connection, use the factory:

```ts
import { makeClient } from '@lucidindex/db/client'
const testDb = makeClient(process.env.TEST_DATABASE_URL!)
```

## Phase scope

Phase 1 covers exactly four tables:

- `admins`
- `credentials` (passkeys)
- `recovery_codes`
- `cron_runs`

The full content / queue / settings schema lands in Phase 2 (see issue
[#31](https://github.com/lxrbckl-dev/Project-LucidIndex/issues/31)).
