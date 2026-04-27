/**
 * Lightweight stack helper for mock-mode e2e specs.
 *
 * Unlike `dev-server.ts` (which spins up Postgres + runs migrations),
 * this helper boots ONLY the Next.js dev server with `LUCIDINDEX_MOCK=1`
 * set. There is no Postgres container because every mock-mode route
 * short-circuits before the lazy DB client is touched.
 *
 * Listening port: `LUCIDINDEX_E2E_MOCK_WEB_PORT` (default: 3402) — one
 * above the founding-admin suite's 3401 so both can coexist on the
 * same host during development (though Playwright's `workers: 1`
 * already serialises spec files sequentially).
 *
 * WebAuthn RP config: not required for mock-mode specs — no passkey
 * ceremonies run. WEBAUTHN_ORIGIN is still set for completeness (the
 * article-page `getBaseUrl()` reads it to build absolute OG image URLs).
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

const WEB_BIND_HOST = '127.0.0.1'
const WEB_BROWSER_HOST = 'localhost'
const WEB_PORT = Number(process.env.LUCIDINDEX_E2E_MOCK_WEB_PORT ?? '3402')

export type StackHandle = {
  baseURL: string
  teardown: () => Promise<void>
}

export async function startMockStack(): Promise<StackHandle> {
  const baseURL = `http://${WEB_BROWSER_HOST}:${WEB_PORT}`

  log(`spawning next dev (mock-mode) on ${WEB_BIND_HOST}:${WEB_PORT}`)

  // iron-session refuses passwords < 32 chars — set one even though
  // mock-mode specs don't exercise passkey flows.
  const ironSecret = 'lucidindex_e2e_mock_iron_session_password'

  const webEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // No DATABASE_URL — mock mode never touches the DB client.
    LUCIDINDEX_MOCK: '1',
    IRON_SESSION_PASSWORD: ironSecret,
    WEBAUTHN_RP_ID: WEB_BROWSER_HOST,
    WEBAUTHN_ORIGIN: `http://${WEB_BROWSER_HOST}:${WEB_PORT}`,
    HOST: WEB_BIND_HOST,
    PORT: String(WEB_PORT),
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
      detached: true,
    },
  )

  dev.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[mock-web] ${chunk}`))
  dev.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mock-web] ${chunk}`))

  async function teardown(): Promise<void> {
    log('tearing down mock-mode web server')
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
  }

  try {
    await waitForHttpOk(baseURL, { timeoutMs: 90_000 })
  } catch (err) {
    log(`mock-mode web server failed to come up at ${baseURL}: ${(err as Error).message}`)
    await teardown()
    throw err
  }

  log(`mock-mode stack ready at ${baseURL}`)
  return { baseURL, teardown }
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e:mock-server] ${msg}`)
}
