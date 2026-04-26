/**
 * Stack lifecycle helper for the Phase 3 mcp-store acceptance suite.
 *
 * Mirrors the shape of `dev-server.ts` (which boots Postgres + Next.js for
 * the founding-admin / settings specs) but starts a different pair of
 * processes:
 *
 *   1. A throw-away Postgres 16 container on `127.0.0.1:5441` (one port up
 *      from the founding-admin suite at 5440 so concurrent local runs
 *      don't collide).
 *   2. `pnpm db:migrate` against the throw-away DB.
 *   3. `pnpm db:seed` so the 7 starter prompt templates exist (the
 *      acceptance test references the `website` template by slug).
 *   4. `pnpm --filter @lucidindex/mcp-store dev` (tsx watch on
 *      src/server.ts) on `127.0.0.1:4401` (one port up from `4400`-ish
 *      manual smokes the README documents).
 *   5. Polls `GET /healthz` until it returns 200.
 *
 * Returns:
 *   - `baseURL`: the http base URL of the sidecar (`http://127.0.0.1:4401`).
 *   - `databaseUrl`: connection string for the throw-away Postgres.
 *   - `mcpEnv`: env block (DATABASE_URL + MCP_PORT + MCP_TRANSPORT=stdio)
 *     suitable for spawning a fresh stdio-mode mcp-store process inside
 *     the test (test 4 needs this — same DB, different transport).
 *   - `teardown()`: kills the dev server and removes the container. Always
 *     called from `afterAll` regardless of test outcome.
 *
 * NOTE on transport mode:
 *   Phase 3 #39 made the HTTP transport stateless — the MCP `initialize`
 *   handshake is optional. Tests POST `tools/list` / `tools/call` directly
 *   to the JSON-RPC endpoint via `fetch`, which matches both the README's
 *   smoke procedure and the SDK's stateless-streamable-http example. Using
 *   the SDK's `Client` would force an `initialize` handshake the stateless
 *   server doesn't expect.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

const PG_HOST = '127.0.0.1'
const PG_PORT = Number(process.env.LUCIDINDEX_E2E_MCP_PG_PORT ?? '5441')
const PG_USER = 'lucidindex'
const PG_PASSWORD = 'lucidindex_e2e_mcp'
const PG_DB = 'lucidindex'
const PG_CONTAINER_NAME = 'lucidindex-e2e-mcp-postgres'

const MCP_BIND_HOST = '127.0.0.1'
const MCP_PORT = Number(process.env.LUCIDINDEX_E2E_MCP_PORT ?? '4401')

const DATABASE_URL = `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}`

export type McpStackHandle = {
  baseURL: string
  databaseUrl: string
  pgContainerName: string
  /**
   * Env block for spawning a stdio-mode mcp-store child process (test 4).
   * Caller still has to set MCP_TRANSPORT=stdio explicitly.
   */
  mcpEnv: NodeJS.ProcessEnv
  teardown: () => Promise<void>
}

export async function startMcpStack(): Promise<McpStackHandle> {
  await removeContainerIfExists(PG_CONTAINER_NAME)

  log(`starting postgres container ${PG_CONTAINER_NAME} on ${PG_HOST}:${PG_PORT}`)
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      PG_CONTAINER_NAME,
      '-e',
      `POSTGRES_DB=${PG_DB}`,
      '-e',
      `POSTGRES_USER=${PG_USER}`,
      '-e',
      `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-p',
      `${PG_HOST}:${PG_PORT}:5432`,
      'postgres:16-alpine',
    ],
    { stdio: 'pipe' },
  )

  await waitForPostgres({ timeoutMs: 30_000 })

  log('running pnpm db:migrate against e2e mcp postgres')
  execFileSync('pnpm', ['db:migrate'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  })

  log('running pnpm db:seed against e2e mcp postgres')
  execFileSync('pnpm', ['db:seed'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  })

  log(`spawning mcp-store on ${MCP_BIND_HOST}:${MCP_PORT}`)
  const mcpEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL,
    MCP_PORT: String(MCP_PORT),
    MCP_TRANSPORT: 'http',
    NODE_ENV: 'test',
  }

  // Run with plain `tsx` (no `watch`) — tests should not have hot-reload
  // semantics, and the watch loop occasionally restarts the process between
  // assertions which silently resets the in-memory pre-admin-guard cache.
  const dev: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@lucidindex/mcp-store', 'exec', 'tsx', 'src/server.ts'],
    {
      cwd: REPO_ROOT,
      env: mcpEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Detach so we can SIGTERM the whole process group on teardown — pnpm
      // forks a child shell that survives a plain SIGTERM to the parent
      // otherwise.
      detached: true,
    },
  )

  dev.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[mcp] ${chunk}`))
  dev.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp] ${chunk}`))

  const baseURL = `http://${MCP_BIND_HOST}:${MCP_PORT}`

  try {
    await waitForHealthz(baseURL, { timeoutMs: 60_000 })
  } catch (err) {
    log(`mcp-store failed to come up at ${baseURL}: ${(err as Error).message}`)
    await teardown()
    throw err
  }

  log(`mcp stack ready at ${baseURL}`)

  async function teardown(): Promise<void> {
    log('tearing down mcp stack')
    if (dev.pid !== undefined && !dev.killed) {
      try {
        process.kill(-dev.pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
      await sleep(500)
      if (dev.pid !== undefined) {
        try {
          process.kill(-dev.pid, 'SIGKILL')
        } catch {
          // Ditto.
        }
      }
    }
    await removeContainerIfExists(PG_CONTAINER_NAME)
  }

  return {
    baseURL,
    databaseUrl: DATABASE_URL,
    pgContainerName: PG_CONTAINER_NAME,
    mcpEnv,
    teardown,
  }
}

async function waitForPostgres(opts: { timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      execFileSync(
        'docker',
        ['exec', PG_CONTAINER_NAME, 'pg_isready', '-U', PG_USER, '-d', PG_DB],
        { stdio: 'pipe' },
      )
      return
    } catch (err) {
      lastErr = err
      await sleep(500)
    }
  }
  throw new Error(`postgres never became ready: ${(lastErr as Error)?.message ?? 'unknown'}`)
}

async function waitForHealthz(baseURL: string, opts: { timeoutMs: number }): Promise<void> {
  const url = `${baseURL}/healthz`
  const deadline = Date.now() + opts.timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.status === 200) {
        return
      }
      lastErr = new Error(`status ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(500)
  }
  throw new Error(`healthz never became reachable: ${(lastErr as Error)?.message ?? 'unknown'}`)
}

async function removeContainerIfExists(name: string): Promise<void> {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  } catch {
    // Not present; nothing to do.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e:mcp-server] ${msg}`)
}

/**
 * Run a SQL statement against the throw-away Postgres via `docker exec
 * psql`. Returns the captured stdout, with psql command tags (e.g.
 * `INSERT 0 1`, `UPDATE 1`) filtered out — we only care about the data
 * tuples (`-At`) plus any `RETURNING` payload.
 *
 * Use for setup/teardown of test data (seeding admins, agent_tokens,
 * targets, queue rows) — drizzle would also work but psql keeps tests
 * close to the README's smoke procedure and doesn't drag a Drizzle
 * client through node_modules resolution.
 */
export function execSql(sql: string): string {
  const out = execFileSync(
    'docker',
    ['exec', PG_CONTAINER_NAME, 'psql', '-U', PG_USER, '-d', PG_DB, '-At', '-q', '-c', sql],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  // psql -At -q strips most chatter but command tags (`INSERT 0 1`,
  // `UPDATE 1`, `DELETE 0`) still show up on stdout when the query
  // includes a write. Filter those lines out so callers parsing the
  // result (e.g. `RETURNING id`) see only the data rows.
  const COMMAND_TAG_RX = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|SELECT \d+)$/
  return out
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !COMMAND_TAG_RX.test(line))
    .join('\n')
    .trim()
}
