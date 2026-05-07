/**
 * Phase 3 acceptance test — mcp-store sidecar end-to-end (#47).
 *
 * Boots a fresh Postgres + a fresh `mcp-store` HTTP-transport sidecar via
 * `support/mcp-server.ts`, then drives the 5-tool surface end-to-end as
 * an MCP client would. Captures the Plan-of-Attack "Done when" for Phase
 * 3:
 *
 *   1. Pre-admin guard — empty `admins` table → tools refuse with
 *      `no_admin_enrolled`, regardless of bearer auth status.
 *   2. Bearer-authenticated happy path on Streamable HTTP —
 *      get_topic_badges → pull_queue_item (with Liquid-rendered prompt)
 *      → write_articles (accepted, deduped:false) → ack_queue_item.
 *   3. Bearer auth rejection — missing header / wrong scheme / unknown
 *      token / revoked token all return HTTP 401.
 *   4. stdio transport happy path — spawn `mcp-store` with
 *      `MCP_TRANSPORT=stdio`, send `tools/list` over stdin, read 5 tools
 *      back from stdout. Stdio bypasses bearer auth (process-local
 *      trust) — verified by sending no auth at all.
 *   5. Dedup — write_articles twice with the same `(target_id,
 *      source_url)` returns `deduped: true` the second time and only
 *      one row exists in `articles`.
 *
 * Why fetch instead of the SDK's Client class:
 *   The HTTP transport is stateless (no `Mcp-Session-Id`, no
 *   `initialize` requirement). Posting JSON-RPC bodies straight to `/mcp`
 *   matches the README's smoke procedure exactly and skips the SDK
 *   client's automatic init handshake (which the stateless server doesn't
 *   serve).
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hash as argonHash } from '@node-rs/argon2'
import { expect, test } from '@playwright/test'
import { execSql, type McpStackHandle, startMcpStack } from './support/mcp-server'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

let stack: McpStackHandle

test.beforeAll(async () => {
  stack = await startMcpStack()
})

test.afterAll(async () => {
  if (stack) {
    await stack.teardown()
  }
})

// ---------------------------------------------------------------------------
// Test 1 — pre-admin guard fires when admins table is empty.
// ---------------------------------------------------------------------------
//
// Order matters: this test runs BEFORE the others insert admins. Playwright
// executes specs in file order with `fullyParallel: false` + `workers: 1`,
// so we get a deterministic sequence within the file.

test('1. pre-admin guard — empty admins table refuses with no_admin_enrolled', async () => {
  // Pre-condition: admins table is empty (fresh stack).
  const adminCount = execSql('SELECT count(*) FROM admins;')
  expect(adminCount).toBe('0')

  // We need a token row so the call gets PAST bearer auth and into the
  // pre-admin guard. Mint and persist one.
  const { token } = await mintAndPersistToken('pre-admin-test')

  const res = await callTool(stack.baseURL, token, 'get_topic_badges', {})
  expect(res.httpStatus).toBe(200)
  // The MCP SDK frames tool errors as `isError: true` with structured
  // `{ error: { code, message } }`. We assert the code, not the message.
  expect(res.body.result?.isError).toBe(true)
  const structuredError = (
    res.body.result?.structuredContent as { error?: { code?: string } } | undefined
  )?.error
  expect(structuredError?.code).toBe('no_admin_enrolled')
})

// ---------------------------------------------------------------------------
// Test 2 — bearer happy path on Streamable HTTP.
// ---------------------------------------------------------------------------

test('2. bearer auth happy path — pull/write/ack via Streamable HTTP', async () => {
  // Insert founding admin so the pre-admin guard stops firing. The mcp-store
  // caches "admins exist" for 5s once true — we never delete admins (NO
  // DELETIONS) so re-inserting is safe; existing rows are tolerated.
  execSql(`INSERT INTO admins (name) VALUES ('AcceptanceAdmin') ON CONFLICT DO NOTHING;`)

  // Fresh token for this test (separate label from test 1 / 3).
  const { token, tokenId } = await mintAndPersistToken('happy-path-test')

  // Seed topic badges so write_articles' default-mode validation has
  // entries to match against.
  execSql(`
    INSERT INTO topic_badges (name, display_order) VALUES
      ('AI', 1), ('Astronomy', 2)
    ON CONFLICT (name) DO NOTHING;
  `)

  // Need a target + a queue row. Reference the seeded `website` template by
  // slug so we don't have to know its uuid. The seed also populates
  // cross_source_n=3 on the website template by default.
  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, high_water_mark)
    VALUES (
      'Phase3 TestTarget',
      'https://example.com/phase3',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      '"2026-04-25T00:00:00Z"'::jsonb
    );
  `)
  execSql(`
    INSERT INTO queue (target_id)
    VALUES ((SELECT id FROM targets WHERE label = 'Phase3 TestTarget' LIMIT 1));
  `)

  // The pre-admin-guard caches admin existence for 5 seconds — wait it out
  // so the cached "false" from test 1 doesn't bleed into test 2's first
  // call. (The cache flips to permanent-true once it sees a row, so this
  // sleep is ONLY needed once on the transition.)
  await waitForAdminGuardCache()

  // 2a. get_topic_badges → returns the seeded badges.
  const badges = await callToolOk(stack.baseURL, token, 'get_topic_badges', {})
  const badgeRows = badges.structuredContent.badges as Array<{ name: string }>
  const badgeNames = badgeRows.map((b) => b.name).sort()
  expect(badgeNames).toEqual(['AI', 'Astronomy'])

  // 2b. pull_queue_item → returns a queue_item_id, target_id, and a Liquid-
  // rendered prompt with NO unrendered `{{ ... }}` substitutions left.
  const pull = await callToolOk(stack.baseURL, token, 'pull_queue_item', {})
  const pulled = pull.structuredContent as Record<string, unknown>
  const queueItemId = pulled.queue_item_id as string
  expect(queueItemId).toMatch(/^[0-9a-f-]{36}$/)
  expect(pulled.target_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(pulled.url_or_handle).toBe('https://example.com/phase3')
  expect(pulled.label).toBe('Phase3 TestTarget')
  // Liquid render assertion — no raw `{{ … }}` should survive.
  const renderedPrompt = pulled.rendered_prompt as string
  expect(renderedPrompt).toBeTruthy()
  expect(renderedPrompt).not.toMatch(/\{\{\s*creator_name\s*\}\}/)
  expect(renderedPrompt).not.toMatch(/\{\{\s*target_url\s*\}\}/)
  // The website starter template references creator_name / target_url; the
  // rendered output should contain the substituted values.
  expect(renderedPrompt).toContain('Phase3 TestTarget')
  expect(renderedPrompt).toContain('https://example.com/phase3')

  // 2c. write_articles → accepted: 1, results[0].deduped: false, and an
  // articles row exists.
  const sourceUrl = `https://example.com/p1?n=${randomUUID()}`
  const wrote = await callToolOk(stack.baseURL, token, 'write_articles', {
    queue_item_id: queueItemId,
    articles: [
      {
        source_url: sourceUrl,
        title: 'Phase 3 happy-path article',
        summary: 'A short summary for the acceptance test.',
        topic_badges: ['AI'],
        significance: 'medium',
        difficulty: 'easy',
      },
    ],
  })
  const wroteOut = wrote.structuredContent as {
    accepted: number
    results: Array<{ id: string; deduped: boolean }>
  }
  expect(wroteOut.accepted).toBe(1)
  expect(wroteOut.results[0]?.deduped).toBe(false)
  expect(wroteOut.results[0]?.id).toMatch(/^[0-9a-f-]{36}$/)

  // Database side-effect check: the articles row exists, points at the
  // expected target, and was written by THIS agent_token.
  const articleRow = execSql(`
    SELECT id || '|' || agent_token_id FROM articles
    WHERE source_url = '${sourceUrl}';
  `)
  // biome-ignore lint/style/noNonNullAssertion: accepted=1 above guarantees results[0]
  expect(articleRow).toContain(wroteOut.results[0]!.id)
  expect(articleRow).toContain(tokenId)

  // 2d. ack_queue_item → { ok: true } and the queue row is acked.
  const acked = await callToolOk(stack.baseURL, token, 'ack_queue_item', {
    queue_item_id: queueItemId,
    status: 'succeeded',
  })
  expect(acked.structuredContent).toEqual({ ok: true })

  const ackedAt = execSql(`SELECT acked_at FROM queue WHERE id = '${queueItemId}';`)
  expect(ackedAt).not.toBe('')
  expect(ackedAt).not.toBe('null')
})

// ---------------------------------------------------------------------------
// Test 3 — bearer auth rejection.
// ---------------------------------------------------------------------------

test('3. bearer auth rejection — 401 on missing / wrong / unknown / revoked', async () => {
  // Make sure the per-process arrgon2-verify scan has at least one valid
  // active token to compare against (we revoke a different one below).
  await mintAndPersistToken('aux-active-for-rejection-tests')

  // 3a. No Authorization header → 401.
  {
    const res = await rawCallTool(stack.baseURL, undefined, 'get_topic_badges', {})
    expect(res.httpStatus).toBe(401)
    expect(res.body.error).toBe('unauthorized')
    expect(res.body.reason).toBe('missing_authorization_header')
  }

  // 3b. Wrong scheme (`Basic foo`) → 401 with `wrong_scheme`.
  {
    const res = await rawCallTool(stack.baseURL, 'Basic foo', 'get_topic_badges', {})
    expect(res.httpStatus).toBe(401)
    expect(res.body.reason).toBe('wrong_scheme')
  }

  // 3c. Valid-shape bearer that doesn't match any agent_token row → 401
  // with `no_matching_token`.
  {
    const fakeToken = randomBytes(32).toString('base64url')
    const res = await rawCallTool(stack.baseURL, `Bearer ${fakeToken}`, 'get_topic_badges', {})
    expect(res.httpStatus).toBe(401)
    expect(res.body.reason).toBe('no_matching_token')
  }

  // 3d. Revoked token → 401 with `token_revoked`.
  {
    const { token, tokenId } = await mintAndPersistToken('to-be-revoked')
    execSql(`UPDATE agent_tokens SET revoked_at = now() WHERE id = '${tokenId}';`)
    const res = await rawCallTool(stack.baseURL, `Bearer ${token}`, 'get_topic_badges', {})
    expect(res.httpStatus).toBe(401)
    expect(res.body.reason).toBe('token_revoked')
  }
})

// ---------------------------------------------------------------------------
// Test 4 — stdio transport happy path (smaller scope: tools/list).
// ---------------------------------------------------------------------------

test('4. stdio transport — tools/list returns the 12 registered tools', async () => {
  // Spawn a fresh mcp-store child in stdio mode against the same DB. Stdio
  // bypasses bearer auth (process-local trust) — we verify by sending no
  // headers (which is moot for stdio, since headers don't exist in
  // JSON-RPC over stdin/stdout anyway).
  const child: ChildProcessWithoutNullStreams = spawn(
    'pnpm',
    ['--filter', '@lucidindex/mcp-store', 'exec', 'tsx', 'src/server.ts'],
    {
      cwd: REPO_ROOT,
      env: { ...stack.mcpEnv, MCP_TRANSPORT: 'stdio' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ) as ChildProcessWithoutNullStreams

  // Buffer stdout — JSON-RPC responses arrive line-delimited, but the SDK
  // uses Content-Length-framed messages on stdio. We accumulate everything
  // and look for our specific id.
  let stdoutBuf = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8')
  })
  // Forward stderr for debugging (mcp-store redirects all logs to stderr
  // in stdio mode).
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[mcp-stdio] ${chunk}`)
  })

  try {
    // The SDK's stdio framing is plain newline-delimited JSON-RPC (NOT
    // LSP-style Content-Length). One JSON-RPC message per line.
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'phase3-acceptance-test', version: '0.0.0' },
      },
    })
    child.stdin.write(`${initReq}\n`)

    // Wait for initialize response before listing tools — the SDK's
    // McpServer enforces the handshake on stdio.
    await waitFor(() => stdoutBuf.includes('"id":1'), { timeoutMs: 30_000 })

    const initializedNote = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    child.stdin.write(`${initializedNote}\n`)

    const listReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
    child.stdin.write(`${listReq}\n`)

    await waitFor(() => stdoutBuf.includes('"id":2'), { timeoutMs: 15_000 })

    // Find the line whose JSON parses to our id=2 reply.
    const lines = stdoutBuf.split('\n').filter((l) => l.trim())
    const reply = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { id?: number; result?: { tools?: Array<{ name: string }> } }
        } catch {
          return null
        }
      })
      .find((m): m is NonNullable<typeof m> => m !== null && m.id === 2)
    expect(reply).toBeDefined()
    // biome-ignore lint/style/noNonNullAssertion: expect().toBeDefined() above guarantees non-null
    const tools = (reply!.result?.tools ?? []).map((t) => t.name).sort()
    expect(tools).toEqual([
      'ack_queue_item',
      'extend_queue_lock',
      'get_comparison_sources',
      'get_high_water_mark',
      'get_topic_badges',
      'list_targets',
      'pull_queue_item',
      'search_articles',
      'write_articles',
      'write_target_description',
      'write_target_photo_url',
      'write_target_social_url',
    ])
  } finally {
    child.kill('SIGTERM')
    await new Promise<void>((r) => {
      child.once('exit', () => r())
      // Hard-stop fallback if SIGTERM is ignored.
      setTimeout(() => {
        if (child.exitCode === null) {
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone.
          }
        }
      }, 1500)
    })
  }
})

// ---------------------------------------------------------------------------
// Test 5 — dedup behavior: repeat (target_id, source_url) → deduped: true.
// ---------------------------------------------------------------------------

test('5. dedup — same (target_id, source_url) twice returns deduped:true with same id', async () => {
  const { token } = await mintAndPersistToken('dedup-test')

  // Fresh target + queue row dedicated to this test (each call to
  // pull_queue_item consumes a row, so we need a new one).
  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
    VALUES (
      'Phase3 DedupTarget',
      'https://example.com/dedup',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now()
    );
  `)
  execSql(`
    INSERT INTO queue (target_id)
    VALUES ((SELECT id FROM targets WHERE label = 'Phase3 DedupTarget' LIMIT 1));
  `)

  // First pull — claim the queue row for write_articles call #1.
  const pull1 = await callToolOk(stack.baseURL, token, 'pull_queue_item', {})
  const queueItemId1 = (pull1.structuredContent as { queue_item_id: string }).queue_item_id

  const sharedSourceUrl = `https://example.com/dedup-article?n=${randomUUID()}`

  // First write — accepts, deduped: false.
  const wrote1 = await callToolOk(stack.baseURL, token, 'write_articles', {
    queue_item_id: queueItemId1,
    articles: [
      {
        source_url: sharedSourceUrl,
        title: 'Dedup test article',
        summary: 'First write should land.',
        topic_badges: ['AI'],
        significance: 'small',
        difficulty: 'easy',
      },
    ],
  })
  const out1 = wrote1.structuredContent as {
    accepted: number
    results: Array<{ id: string; deduped: boolean }>
  }
  expect(out1.accepted).toBe(1)
  expect(out1.results[0]?.deduped).toBe(false)
  // biome-ignore lint/style/noNonNullAssertion: accepted=1 above guarantees results[0]
  const firstArticleId = out1.results[0]!.id

  // Second write — same (target_id, source_url). Returns deduped: true with
  // the existing article id. Use the same queue_item_id (it's still
  // claimed; we haven't acked).
  const wrote2 = await callToolOk(stack.baseURL, token, 'write_articles', {
    queue_item_id: queueItemId1,
    articles: [
      {
        source_url: sharedSourceUrl,
        title: 'Dedup test article (round 2 — should be ignored)',
        summary: 'Second write should be deduped.',
        topic_badges: ['AI'],
        significance: 'small',
        difficulty: 'easy',
      },
    ],
  })
  const out2 = wrote2.structuredContent as {
    accepted: number
    results: Array<{ id: string; deduped: boolean }>
  }
  expect(out2.accepted).toBe(1)
  expect(out2.results[0]?.deduped).toBe(true)
  expect(out2.results[0]?.id).toBe(firstArticleId)

  // DB side-effect: still exactly one article for this (target, source_url).
  const dbCount = execSql(`
    SELECT count(*) FROM articles WHERE source_url = '${sharedSourceUrl}';
  `)
  expect(dbCount).toBe('1')
})

// ---------------------------------------------------------------------------
// Test 6 — get_topic_badges excludes hidden badges.
// ---------------------------------------------------------------------------

test('6. get_topic_badges excludes hidden badges', async () => {
  const { token } = await mintAndPersistToken('hidden-badge-test')

  // Insert one visible + one hidden badge (idempotent against earlier seeds).
  execSql(`
    INSERT INTO topic_badges (name, display_order, hidden) VALUES
      ('VisibleBadge', 100, false),
      ('HiddenBadge', 101, true)
    ON CONFLICT (name) DO UPDATE SET hidden = EXCLUDED.hidden;
  `)

  const res = await callToolOk(stack.baseURL, token, 'get_topic_badges', {})
  const out = res.structuredContent as { badges: Array<{ name: string }> }
  const names = out.badges.map((b) => b.name)
  expect(names).toContain('VisibleBadge')
  expect(names).not.toContain('HiddenBadge')
})

// ---------------------------------------------------------------------------
// Test 7 — citations + agent_opinion round-trip through write_articles.
// ---------------------------------------------------------------------------

test('7. write_articles persists citations + agent_opinion', async () => {
  const { token } = await mintAndPersistToken('citations-test')

  // Seed a comparison source so the citation has a valid source_name.
  execSql(`
    INSERT INTO comparison_sources (name, base_url, is_active)
    VALUES ('Wikipedia', 'https://en.wikipedia.org', true)
    ON CONFLICT (name) DO UPDATE SET is_active = true;
  `)

  // Fresh target + queue row dedicated to this test.
  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
    VALUES (
      'Phase3 CitationsTarget',
      'https://example.com/citations',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now()
    );
  `)
  execSql(`
    INSERT INTO queue (target_id)
    VALUES ((SELECT id FROM targets WHERE label = 'Phase3 CitationsTarget' LIMIT 1));
  `)

  const pull = await callToolOk(stack.baseURL, token, 'pull_queue_item', {})
  const queueItemId = (pull.structuredContent as { queue_item_id: string }).queue_item_id

  const sourceUrl = `https://example.com/citations-article?n=${randomUUID()}`
  const wrote = await callToolOk(stack.baseURL, token, 'write_articles', {
    queue_item_id: queueItemId,
    articles: [
      {
        source_url: sourceUrl,
        title: 'Citations test article',
        summary: 'Validates citations + agent_opinion plumbing.',
        agent_opinion: 'A measured take on this development.',
        topic_badges: ['AI'],
        significance: 'small',
        difficulty: 'easy',
        citations: [
          {
            url: 'https://en.wikipedia.org/wiki/Test',
            title: 'Test (Wikipedia)',
            source_name: 'Wikipedia',
          },
        ],
      },
    ],
  })
  const out = wrote.structuredContent as {
    accepted: number
    results: Array<{ id: string }>
  }
  expect(out.accepted).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: accepted=1 above guarantees results[0]
  const articleId = out.results[0]!.id

  // DB side-effect: agent_opinion + citations persisted.
  const opinion = execSql(`SELECT agent_opinion FROM articles WHERE id = '${articleId}';`)
  expect(opinion).toBe('A measured take on this development.')
  const citationsCount = execSql(
    `SELECT jsonb_array_length(citations)::int FROM articles WHERE id = '${articleId}';`,
  )
  expect(citationsCount).toBe('1')
  const sourceName = execSql(
    `SELECT citations->0->>'source_name' FROM articles WHERE id = '${articleId}';`,
  )
  expect(sourceName).toBe('Wikipedia')
})

// ---------------------------------------------------------------------------
// Test 8 — get_comparison_sources returns active sources only.
// ---------------------------------------------------------------------------

test('8. get_comparison_sources returns active sources only', async () => {
  const { token } = await mintAndPersistToken('comparison-sources-test')

  execSql(`
    INSERT INTO comparison_sources (name, base_url, is_active) VALUES
      ('Reuters', 'https://reuters.com', true),
      ('DeadSource', 'https://dead.example', false)
    ON CONFLICT (name) DO UPDATE SET is_active = EXCLUDED.is_active;
  `)

  const res = await callToolOk(stack.baseURL, token, 'get_comparison_sources', {})
  const out = res.structuredContent as { sources: Array<{ name: string; base_url: string }> }
  const names = out.sources.map((s) => s.name)
  expect(names).toContain('Reuters')
  expect(names).not.toContain('DeadSource')
})

// ---------------------------------------------------------------------------
// Test 9 — extend_queue_lock pushes lock_expires_at forward.
// ---------------------------------------------------------------------------

test('9. extend_queue_lock pushes lock_expires_at forward', async () => {
  const { token } = await mintAndPersistToken('extend-lock-test')

  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
    VALUES (
      'Phase3 ExtendLockTarget',
      'https://example.com/extend',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now()
    );
  `)
  execSql(`
    INSERT INTO queue (target_id)
    VALUES ((SELECT id FROM targets WHERE label = 'Phase3 ExtendLockTarget' LIMIT 1));
  `)

  const pull = await callToolOk(stack.baseURL, token, 'pull_queue_item', {})
  const pulled = pull.structuredContent as {
    queue_item_id: string
    lock_expires_at: string
  }

  // Force the locked_until back in time so we can prove the extend pushed it
  // forward beyond the original expiry.
  execSql(`
    UPDATE queue SET locked_until = now() - interval '60 seconds'
    WHERE id = '${pulled.queue_item_id}';
  `)

  const res = await callToolOk(stack.baseURL, token, 'extend_queue_lock', {
    queue_item_id: pulled.queue_item_id,
  })
  const out = res.structuredContent as { ok: boolean; lock_expires_at: string }
  expect(out.ok).toBe(true)
  // New expiry should be in the future (we just bumped it by full TTL).
  expect(new Date(out.lock_expires_at).getTime()).toBeGreaterThan(Date.now())
})

// ---------------------------------------------------------------------------
// Test 10 — search_articles ranks matching articles.
// ---------------------------------------------------------------------------

test('10. search_articles returns ranked hits over the FTS index', async () => {
  const { token } = await mintAndPersistToken('search-test')

  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at)
    VALUES (
      'Phase3 SearchTarget',
      'https://example.com/search',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now()
    );
  `)
  execSql(`
    INSERT INTO queue (target_id)
    VALUES ((SELECT id FROM targets WHERE label = 'Phase3 SearchTarget' LIMIT 1));
  `)

  const pull = await callToolOk(stack.baseURL, token, 'pull_queue_item', {})
  const queueItemId = (pull.structuredContent as { queue_item_id: string }).queue_item_id

  const uniqueWord = `quokkanaut${randomUUID().slice(0, 8)}`
  await callToolOk(stack.baseURL, token, 'write_articles', {
    queue_item_id: queueItemId,
    articles: [
      {
        source_url: `https://example.com/search-article?n=${randomUUID()}`,
        title: `Story about ${uniqueWord}`,
        summary: `A summary featuring the ${uniqueWord} keyword for FTS.`,
        topic_badges: ['AI'],
        significance: 'small',
        difficulty: 'easy',
      },
    ],
  })

  const res = await callToolOk(stack.baseURL, token, 'search_articles', { query: uniqueWord })
  const out = res.structuredContent as { hits: Array<{ title: string; rank: number }> }
  expect(out.hits.length).toBeGreaterThan(0)
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  expect(out.hits[0]!.title).toContain(uniqueWord)
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  expect(out.hits[0]!.rank).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// Test 11 — write_target_description: write-once-when-null semantics.
// ---------------------------------------------------------------------------

test('11. write_target_description writes once, then returns written:false', async () => {
  const { token } = await mintAndPersistToken('target-description-test')

  // Insert a fresh target with description = null so the first write lands.
  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, description)
    VALUES (
      'Phase3 DescriptionTarget',
      'https://example.com/description',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      NULL
    );
  `)
  const targetId = execSql(
    `SELECT id::text FROM targets WHERE label = 'Phase3 DescriptionTarget' LIMIT 1;`,
  )

  // First call should land — written:true.
  const first = await callToolOk(stack.baseURL, token, 'write_target_description', {
    target_id: targetId,
    description: 'Pragmatic essays on distributed systems and operational realism.',
  })
  expect((first.structuredContent as { written: boolean }).written).toBe(true)

  // Confirm the description landed in the row.
  const persisted = execSql(`SELECT description FROM targets WHERE id = '${targetId}';`)
  expect(persisted).toBe('Pragmatic essays on distributed systems and operational realism.')

  // Second call must be a no-op — written:false, original text untouched.
  const second = await callToolOk(stack.baseURL, token, 'write_target_description', {
    target_id: targetId,
    description: 'Different text — must not overwrite.',
  })
  expect((second.structuredContent as { written: boolean }).written).toBe(false)

  const stillOriginal = execSql(`SELECT description FROM targets WHERE id = '${targetId}';`)
  expect(stillOriginal).toBe('Pragmatic essays on distributed systems and operational realism.')
})

// ---------------------------------------------------------------------------
// Test 12 — write_target_social_url: write-once-when-null + URL validation.
// ---------------------------------------------------------------------------

test('12. write_target_social_url writes once, rejects bad URLs, no overwrite', async () => {
  const { token } = await mintAndPersistToken('target-social-url-test')

  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, social_url)
    VALUES (
      'Phase3 SocialUrlTarget',
      'https://example.com/social',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      NULL
    );
  `)
  const targetId = execSql(
    `SELECT id::text FROM targets WHERE label = 'Phase3 SocialUrlTarget' LIMIT 1;`,
  )

  // Reject non-http(s).
  const bad = await callTool(stack.baseURL, token, 'write_target_social_url', {
    target_id: targetId,
    social_url: 'mailto:foo@bar.com',
  })
  expect(bad.body.result?.isError).toBe(true)
  expect(
    (bad.body.result?.structuredContent as { error?: { code?: string } } | undefined)?.error?.code,
  ).toBe('invalid_social_url')

  // First valid write — written:true.
  const first = await callToolOk(stack.baseURL, token, 'write_target_social_url', {
    target_id: targetId,
    social_url: 'https://author.example.com/',
  })
  expect((first.structuredContent as { written: boolean }).written).toBe(true)

  // DB confirms.
  const persisted = execSql(`SELECT social_url FROM targets WHERE id = '${targetId}';`)
  expect(persisted).toBe('https://author.example.com/')

  // Second call — written:false, original untouched.
  const second = await callToolOk(stack.baseURL, token, 'write_target_social_url', {
    target_id: targetId,
    social_url: 'https://different.example.com/',
  })
  expect((second.structuredContent as { written: boolean }).written).toBe(false)

  const stillOriginal = execSql(`SELECT social_url FROM targets WHERE id = '${targetId}';`)
  expect(stillOriginal).toBe('https://author.example.com/')
})

// ---------------------------------------------------------------------------
// Test 13 — list_targets exposes presence flags for cross-reference.
// ---------------------------------------------------------------------------

test('13. list_targets returns presence flags for description + social_url', async () => {
  const { token } = await mintAndPersistToken('list-targets-test')

  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, description, social_url)
    VALUES (
      'Phase3 ListTargetsBoth',
      'https://example.com/both',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      'Has both fields.',
      'https://author-both.example.com/'
    );
  `)
  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, description, social_url)
    VALUES (
      'Phase3 ListTargetsNeither',
      'https://example.com/neither',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      NULL,
      NULL
    );
  `)

  const res = await callToolOk(stack.baseURL, token, 'list_targets', {})
  const out = res.structuredContent as {
    targets: Array<{ label: string; has_description: boolean; has_social_url: boolean }>
  }
  const both = out.targets.find((t) => t.label === 'Phase3 ListTargetsBoth')
  const neither = out.targets.find((t) => t.label === 'Phase3 ListTargetsNeither')
  expect(both).toBeDefined()
  expect(neither).toBeDefined()
  expect(both?.has_description).toBe(true)
  expect(both?.has_social_url).toBe(true)
  expect(neither?.has_description).toBe(false)
  expect(neither?.has_social_url).toBe(false)
})

// ---------------------------------------------------------------------------
// Test 14 — write_target_photo_url: write-once-when-null + URL validation.
// ---------------------------------------------------------------------------

test('14. write_target_photo_url writes once, rejects bad URLs, no overwrite', async () => {
  const { token } = await mintAndPersistToken('target-photo-url-test')

  execSql(`
    INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, photo_url)
    VALUES (
      'Phase3 PhotoUrlTarget',
      'https://example.com/photo',
      'hourly',
      (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
      now(),
      NULL
    );
  `)
  const targetId = execSql(
    `SELECT id::text FROM targets WHERE label = 'Phase3 PhotoUrlTarget' LIMIT 1;`,
  )

  // Reject non-http(s).
  const bad = await callTool(stack.baseURL, token, 'write_target_photo_url', {
    target_id: targetId,
    photo_url: 'data:image/png;base64,abc',
  })
  expect(bad.body.result?.isError).toBe(true)
  expect(
    (bad.body.result?.structuredContent as { error?: { code?: string } } | undefined)?.error?.code,
  ).toBe('invalid_photo_url')

  // First valid write — written:true.
  const first = await callToolOk(stack.baseURL, token, 'write_target_photo_url', {
    target_id: targetId,
    photo_url: 'https://images.example.com/author.jpg',
  })
  expect((first.structuredContent as { written: boolean }).written).toBe(true)

  const persisted = execSql(`SELECT photo_url FROM targets WHERE id = '${targetId}';`)
  expect(persisted).toBe('https://images.example.com/author.jpg')

  // Second call — written:false, original untouched.
  const second = await callToolOk(stack.baseURL, token, 'write_target_photo_url', {
    target_id: targetId,
    photo_url: 'https://images.example.com/different.jpg',
  })
  expect((second.structuredContent as { written: boolean }).written).toBe(false)

  const stillOriginal = execSql(`SELECT photo_url FROM targets WHERE id = '${targetId}';`)
  expect(stillOriginal).toBe('https://images.example.com/author.jpg')
})

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Generate a random 32-byte token (matching the agent-tokens-repo
 * generation), argon2id-hash it, persist the row, and return both the
 * cleartext + the row's uuid.
 */
async function mintAndPersistToken(label: string): Promise<{ token: string; tokenId: string }> {
  const cleartext = randomBytes(32).toString('base64url')
  const tokenHash = await argonHash(cleartext)
  // Escape any single quotes in the hash (argon2 strings include $ but no
  // quotes, but better safe — the hash is opaque). We also pass the label
  // through the same escape for safety (it's caller-controlled in tests
  // but consistency wins).
  const safeLabel = label.replace(/'/g, "''")
  const safeHash = tokenHash.replace(/'/g, "''")
  const tokenId = execSql(
    `INSERT INTO agent_tokens (label, token_hash) VALUES ('${safeLabel}', '${safeHash}') RETURNING id;`,
  )
  return { token: cleartext, tokenId }
}

/**
 * Wait for the mcp-store's pre-admin guard cache to expire (5s TTL). Used
 * exactly once, after seeding the founding admin in test 2 — the cache may
 * still hold a "false" reading from test 1's pre-admin call.
 */
async function waitForAdminGuardCache(): Promise<void> {
  // The guard caches for 5_000ms. Sleep slightly longer to be safe.
  await new Promise((r) => setTimeout(r, 5_500))
}

/**
 * Two valid response body shapes:
 *   - JSON-RPC envelope (200): `{ jsonrpc, id, result | error: { code, message } }`
 *   - Auth-failure envelope (401): `{ error: 'unauthorized', reason: '...' }`
 *
 * The transport layer never returns both at the same time; we type the
 * intersection so callers can probe either shape without further casts.
 */
type ToolCallBody = {
  // JSON-RPC envelope fields.
  jsonrpc?: string
  id?: number
  result?: {
    isError?: boolean
    content?: Array<{ type: string; text: string }>
    structuredContent?: Record<string, unknown>
  }
  // Either:
  //   - JSON-RPC error: `{ code, message }`
  //   - 401 auth-failure: a string like `'unauthorized'` (with `reason`
  //     filled in as a sibling).
  error?: { code: number; message: string } | string
  // 401-only.
  reason?: string
}

type ToolCallResult = {
  httpStatus: number
  body: ToolCallBody
}

/**
 * POST a JSON-RPC `tools/call` to the mcp-store and return parsed body +
 * HTTP status. Bearer header is included if `token` is non-null.
 */
async function callTool(
  baseURL: string,
  token: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return rawPost(baseURL, headers, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
}

/**
 * Same as `callTool` but expects HTTP 200 + `result.isError !== true`.
 * Returns `result` (with `structuredContent` typed as a record). Throws
 * a descriptive error on HTTP non-200 or on a tool-level error.
 */
async function callToolOk(
  baseURL: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  isError?: boolean
  structuredContent: Record<string, unknown>
}> {
  const res = await callTool(baseURL, token, name, args)
  if (res.httpStatus !== 200) {
    throw new Error(
      `${name}: expected HTTP 200, got ${res.httpStatus}. body=${JSON.stringify(res.body)}`,
    )
  }
  if (res.body.error) {
    throw new Error(`${name}: JSON-RPC error: ${JSON.stringify(res.body.error)}`)
  }
  if (res.body.result?.isError) {
    throw new Error(`${name}: tool error: ${JSON.stringify(res.body.result.structuredContent)}`)
  }
  return {
    isError: false,
    structuredContent: (res.body.result?.structuredContent ?? {}) as Record<string, unknown>,
  }
}

/**
 * Variant for the auth-rejection tests — passes the full Authorization
 * header value (including scheme) verbatim, or skips the header entirely
 * if `authHeader` is undefined. Returns the parsed body without throwing
 * on 401.
 */
async function rawCallTool(
  baseURL: string,
  authHeader: string | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (authHeader) headers.Authorization = authHeader
  return rawPost(baseURL, headers, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
}

async function rawPost(
  baseURL: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ToolCallResult> {
  const res = await fetch(`${baseURL}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const httpStatus = res.status
  // Streamable HTTP can serve either application/json (one-shot) or
  // text/event-stream (streamed). For tool-call responses, the server uses
  // either depending on Accept negotiation; we accept both and parse out
  // the JSON-RPC payload.
  const contentType = res.headers.get('content-type') ?? ''
  let parsed: ToolCallResult['body']
  if (contentType.includes('text/event-stream')) {
    parsed = parseSseToJsonRpc(await res.text())
  } else {
    const text = await res.text()
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { error: { code: -1, message: `non-JSON response: ${text}` } }
    }
  }
  return { httpStatus, body: parsed }
}

/**
 * Parse a Server-Sent Events stream into the embedded JSON-RPC payload.
 * The Streamable HTTP transport sends one `event: message\ndata: <json>`
 * frame for the response, then closes. We just pull the last `data:`
 * field.
 */
function parseSseToJsonRpc(text: string): ToolCallResult['body'] {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  if (dataLines.length === 0) {
    return { error: { code: -1, message: `no data frames in SSE: ${text}` } }
  }
  // Last frame is the response (the protocol may interleave keep-alives).
  // biome-ignore lint/style/noNonNullAssertion: length>0 checked above
  const last = dataLines[dataLines.length - 1]!
  try {
    return JSON.parse(last)
  } catch {
    return { error: { code: -1, message: `non-JSON SSE data: ${last}` } }
  }
}

/**
 * Poll a predicate until it returns true or the timeout elapses. Used by
 * the stdio test to wait for buffered JSON-RPC replies on the child's
 * stdout — `child.stdout.on('data', …)` fires asynchronously and we can't
 * use `await child.stdout` directly.
 */
async function waitFor(predicate: () => boolean, opts: { timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`waitFor: predicate never became true within ${opts.timeoutMs}ms`)
}
