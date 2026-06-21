/**
 * Stack lifecycle helpers for the LucidIndex e2e suite.
 *
 * What it does, in order:
 *   1. Spin a throw-away Postgres 16 container on `127.0.0.1:5440` (so it
 *      doesn't collide with `pnpm dev`'s 5432). Container is named after the
 *      test run so a stale one from a previous failed run is replaced.
 *   2. Wait for `pg_isready` to come back green.
 *   3. Run `pnpm db:migrate` against the throw-away DB to apply Phase 1
 *      migrations (admins, credentials, sessions, etc.).
 *   4. Spawn `pnpm --filter @lucidindex/web dev` on a non-default port
 *      (`3401`) so it doesn't collide with someone's local dev server. The
 *      child inherits a `DATABASE_URL` pointing at the throw-away container,
 *      plus the founding-token and iron-session secrets.
 *   5. Poll `GET /` until it returns 200, with a generous boot budget.
 *
 * Returns a `teardown()` that kills the dev server and removes the
 * container — call it from `afterAll` regardless of test outcome.
 *
 * Why not the docker-compose stack: building the production web image takes
 * minutes and we don't get hot reload — overkill for an integration smoke.
 * Phase 8 will add a separate true-stack smoke against `docker compose up`.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

const PG_HOST = '127.0.0.1'
const PG_PORT = Number(process.env.LUCIDINDEX_E2E_PG_PORT ?? '5440')
const PG_USER = 'lucidindex'
const PG_PASSWORD = 'lucidindex_e2e'
const PG_DB = 'lucidindex'
const PG_CONTAINER_NAME = 'lucidindex-e2e-postgres'

// We bind the dev server to `127.0.0.1` for the listening socket, but route
// the browser through the `localhost` hostname so the RP ID (`localhost`)
// matches the page origin. WebAuthn ceremonies are rejected when the RP ID
// is not a registrable suffix of the page's hostname — and `localhost` is
// not a suffix of `127.0.0.1`.
const WEB_BIND_HOST = '127.0.0.1'
const WEB_BROWSER_HOST = 'localhost'
const WEB_PORT = Number(process.env.LUCIDINDEX_E2E_WEB_PORT ?? '3401')

const DATABASE_URL = `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}`

export type StackHandle = {
  baseURL: string
  databaseUrl: string
  teardown: () => Promise<void>
}

export type StartStackInput = {
  /**
   * Legacy `LUCIDINDEX_FOUNDING_TOKEN` value. No longer used — founding is the
   * on-page "Generate token" flow with no env gate — but kept optional for
   * back-compat with callers that still pass it. Ignored when omitted.
   */
  foundingToken?: string
}

export async function startStack(input: StartStackInput = {}): Promise<StackHandle> {
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

  log('running pnpm db:migrate against e2e postgres')
  execFileSync('pnpm', ['db:migrate'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  })

  log(`spawning next dev on ${WEB_BIND_HOST}:${WEB_PORT}`)
  // iron-session refuses passwords < 32 chars; this one is e2e-only.
  const ironSecret = 'lucidindex_e2e_iron_session_password_pad'
  const logDir = mkdtempSync(join(tmpdir(), 'lucidindex-e2e-'))
  const webEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL,
    IRON_SESSION_PASSWORD: ironSecret,
    WEBAUTHN_RP_ID: WEB_BROWSER_HOST,
    WEBAUTHN_ORIGIN: `http://${WEB_BROWSER_HOST}:${WEB_PORT}`,
    ...(input.foundingToken ? { LUCIDINDEX_FOUNDING_TOKEN: input.foundingToken } : {}),
    HOST: WEB_BIND_HOST,
    PORT: String(WEB_PORT),
    // Quiet Next's telemetry / analytics chatter in CI logs.
    NEXT_TELEMETRY_DISABLED: '1',
  }

  const dev: ChildProcess = spawn(
    'pnpm',
    [
      '--filter',
      '@lucidindex/web',
      'exec',
      'next',
      'dev',
      '--port',
      String(WEB_PORT),
      '--hostname',
      WEB_BIND_HOST,
    ],
    {
      cwd: REPO_ROOT,
      env: webEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Detach so we can kill the whole process group on teardown — `next dev`
      // forks a worker that survives a plain SIGTERM to the parent otherwise.
      detached: true,
    },
  )

  dev.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[web] ${chunk}`))
  dev.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[web] ${chunk}`))

  const baseURL = `http://${WEB_BROWSER_HOST}:${WEB_PORT}`

  try {
    await waitForHttpOk(baseURL, { timeoutMs: 90_000 })
  } catch (err) {
    log(`web server failed to come up at ${baseURL}: ${(err as Error).message}`)
    await teardown()
    throw err
  }

  // Warm-compile the challenge-store routes BEFORE the test runs. Next.js dev
  // compiles each route on first request — and start/finish pairs share
  // `lib/challenge-store.ts`'s module-level Map. Compiling the `finish` route
  // lazily AFTER `start` has stashed a challenge resets the Map (the module is
  // re-evaluated as part of finish's bundle build), which makes the in-memory
  // token unredeemable. Warming both halves up front avoids the race. (See the
  // survival caveat in `apps/web/lib/challenge-store.ts`.)
  //
  // Founding itself (`/api/auth/founding/claim`) is a single POST with no
  // challenge, so it needs no pairing — and `prewarm` POSTs, which would
  // CREATE an admin, so it is intentionally NOT warmed. The passkey enrollment
  // that follows a claim DOES use the challenge store, so warm register/*.
  log('warming challenge-store API routes')
  await prewarm(`${baseURL}/api/auth/passkey/register/start`)
  await prewarm(`${baseURL}/api/auth/passkey/register/finish`)
  await prewarm(`${baseURL}/api/auth/passkey/authenticate/start`)
  await prewarm(`${baseURL}/api/auth/passkey/authenticate/finish`)
  // Recovery shares the same challenge-store race: warm start/finish/finalize
  // together so a challenge stashed by `start` survives `finish`'s first build.
  await prewarm(`${baseURL}/api/auth/recovery/start`)
  await prewarm(`${baseURL}/api/auth/recovery/finish`)
  await prewarm(`${baseURL}/api/auth/recovery/finalize`)
  // Also pre-render the gated pages so the layout's redirect logic is
  // compiled before the test asserts on it.
  await prewarm(`${baseURL}/settings`)
  await prewarm(`${baseURL}/settings/login`)
  await prewarm(`${baseURL}/settings/recover`)

  log(`stack ready at ${baseURL}`)

  async function teardown(): Promise<void> {
    log('tearing down stack')
    if (dev.pid !== undefined && !dev.killed) {
      try {
        // Negative pid → kill the whole process group (Next dev + worker).
        process.kill(-dev.pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
      // Best-effort follow-up so a wedged worker can't hold a port.
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
    try {
      rmSync(logDir, { recursive: true, force: true })
    } catch {
      // Non-fatal.
    }
  }

  return { baseURL, databaseUrl: DATABASE_URL, teardown }
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

/**
 * POST a junk body to a route so Next.js compiles its bundle. We don't care
 * about the response — even a 400 means the bundle is built. Errors are
 * swallowed; the real test will surface any actual outage.
 */
async function prewarm(url: string): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } catch {
    // Best-effort.
  }
}

async function waitForHttpOk(url: string, opts: { timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.status >= 200 && res.status < 500) {
        return
      }
      lastErr = new Error(`status ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(750)
  }
  throw new Error(`url never became reachable: ${(lastErr as Error)?.message ?? 'unknown'}`)
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
  console.log(`[e2e:dev-server] ${msg}`)
}
