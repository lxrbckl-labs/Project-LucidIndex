/**
 * LUCIDINDEX_SEED_DEMO — large synthetic-data seeder.
 *
 * Populates an empty DB with a realistic stress-test fixture: 50–80
 * targets, 15–25 topic_badges, 800–1200 articles (with real hero-image
 * fetches through the production image-pipeline), plus topic-badge
 * suggestions, queue items, run_log, and cron_runs rows for the System
 * dashboard. Designed to surface masonry, FTS, retention, mobile-layout,
 * and share-link issues that a small dev DB would hide.
 *
 * Idempotency:
 *   - Runs ONLY on an empty DB. Skips if `targets` OR `articles` has any
 *     row. This is the cheap, sufficient guard against double-seeding on
 *     container restarts. Operators who want to re-seed must drop the
 *     volume.
 *   - Never seeds `admins`, `credentials`, `recovery_codes`,
 *     `agent_tokens`, or `auth_events`. Those tables are governed by the
 *     founding-admin claim flow and the operator-issued token flow.
 *   - Does NOT re-seed `prompt_templates`. Those are inserted by
 *     `seed.ts` (the existing first-boot seeder) before this runs;
 *     targets reference them by slug.
 *
 * Determinism:
 *   - Faker is seeded with a fixed RNG seed (42) so the same env produces
 *     identical fixtures. Rebooting a torn-down stack reproduces the
 *     same article titles, badges, etc. — useful for stress-test repro.
 *
 * Hero images:
 *   - Fetched via picsum.photos (the standard "lorem ipsum for images"
 *     service) and run through the SAME `@lucidindex/shared/image-pipeline`
 *     module that mcp-store uses for production agent writes. Disk
 *     layout and content-hash format are identical, so the dashboard's
 *     image-serve route resolves seeded and real images via the same
 *     code path. Images take time — we batch concurrency to 12 and log
 *     progress every 100 articles so the seeder is observable in
 *     container logs.
 *
 * Failure model:
 *   - Image-fetch failures are non-fatal (matches production
 *     write_articles behaviour) — the article inserts with a null
 *     hero_image_hash and renders the placeholder tile. A network-down
 *     environment still produces a usable demo DB, just without imagery.
 */

import { fetchAndStoreHeroImage } from '@lucidindex/shared/image-pipeline'
import { sql } from 'drizzle-orm'
import { db } from './client.js'
import {
  agentTokens,
  articles,
  cronRuns,
  promptTemplates,
  queue,
  runLog,
  targets,
  topicBadgeSuggestions,
  topicBadges,
} from './schema/index.js'

// Faker is loaded lazily so the seed-demo module can be imported (e.g. by
// unit tests against the parser / idempotency check) without paying the
// faker import cost. The seeder itself awaits this dynamic import.
type Faker = typeof import('@faker-js/faker').faker

// ----------------------- Curated fixture sources -----------------------

/**
 * Real-feeling editorial categories. The seeder picks 15–25 of these to
 * actually create as `topic_badges` rows; the chosen subset varies by
 * faker's RNG seed.
 */
const TOPIC_BADGE_POOL = [
  'AI',
  'Climate',
  'Architecture',
  'Music',
  'Politics',
  'Science',
  'Design',
  'Books',
  'Film',
  'Economics',
  'Health',
  'Tech Industry',
  'Urbanism',
  'History',
  'Philosophy',
  'Food',
  'Sports',
  'Photography',
  'Long Reads',
  'Interviews',
  'Energy',
  'Education',
  'Travel',
  'Fashion',
  'Theatre',
] as const

/**
 * Real-feeling target labels. Each entry pairs a label with a source type
 * so the matching prompt_template can be looked up. The seeder picks
 * 50–80 of these (with replacement uniqueness disambiguated by
 * faker-generated handles).
 */
type SourceType = 'youtube' | 'blog' | 'newsletter' | 'news' | 'instagram' | 'x' | 'website'

const TARGET_LABEL_POOL: { label: string; source: SourceType }[] = [
  { label: 'Stratechery', source: 'newsletter' },
  { label: 'Marginal Revolution', source: 'blog' },
  { label: 'Astral Codex Ten', source: 'blog' },
  { label: 'Maggie Appleton', source: 'website' },
  { label: 'Architectural Digest', source: 'news' },
  { label: 'Dezeen', source: 'news' },
  { label: 'ArchDaily', source: 'news' },
  { label: 'The Pragmatic Engineer', source: 'newsletter' },
  { label: "Lenny's Newsletter", source: 'newsletter' },
  { label: 'Ben Thompson on YouTube', source: 'youtube' },
  { label: 'Veritasium', source: 'youtube' },
  { label: '3Blue1Brown', source: 'youtube' },
  { label: 'Kurzgesagt', source: 'youtube' },
  { label: 'Wait But Why', source: 'blog' },
  { label: 'The Browser', source: 'newsletter' },
  { label: 'Arts & Letters Daily', source: 'website' },
  { label: 'The Atlantic', source: 'news' },
  { label: 'The New Yorker', source: 'news' },
  { label: 'Hacker News', source: 'website' },
  { label: 'Lobsters', source: 'website' },
  { label: 'The Diff', source: 'newsletter' },
  { label: 'Money Stuff', source: 'newsletter' },
  { label: 'Slow Boring', source: 'newsletter' },
  { label: 'Construction Physics', source: 'blog' },
  { label: 'Works in Progress', source: 'blog' },
  { label: 'Asterisk Magazine', source: 'website' },
  { label: 'Long Now Foundation', source: 'website' },
  { label: 'The MIT Press Reader', source: 'blog' },
  { label: 'Quanta Magazine', source: 'news' },
  { label: 'Ars Technica', source: 'news' },
  { label: 'The Verge', source: 'news' },
  { label: '404 Media', source: 'news' },
  { label: 'Rest of World', source: 'news' },
  { label: 'Mary Meeker Reports', source: 'website' },
  { label: 'Andreessen Horowitz', source: 'blog' },
  { label: 'Bloomberg Opinion', source: 'news' },
  { label: 'The Information', source: 'news' },
  { label: 'Read Max', source: 'newsletter' },
  { label: 'Garbage Day', source: 'newsletter' },
  { label: 'Today in Tabs', source: 'newsletter' },
  { label: 'Casey Newton on Platformer', source: 'newsletter' },
  { label: 'Anil Dash', source: 'blog' },
  { label: 'Robin Sloan', source: 'newsletter' },
  { label: 'Tom Critchlow', source: 'blog' },
  { label: 'Julia Evans', source: 'blog' },
  { label: 'Dan Luu', source: 'blog' },
  { label: 'Simon Willison', source: 'blog' },
  { label: 'Fly.io Blog', source: 'blog' },
  { label: 'Vercel Blog', source: 'blog' },
  { label: 'GitHub Blog', source: 'blog' },
  { label: 'Stack Overflow Blog', source: 'blog' },
  { label: 'Increment', source: 'website' },
  { label: 'A List Apart', source: 'website' },
  { label: 'CSS-Tricks', source: 'website' },
  { label: 'Smashing Magazine', source: 'website' },
  { label: '@dhh', source: 'x' },
  { label: '@swyx', source: 'x' },
  { label: '@karpathy', source: 'x' },
  { label: '@sama', source: 'x' },
  { label: '@levelsio', source: 'x' },
  { label: '@patio11', source: 'x' },
  { label: '@stevesi', source: 'x' },
  { label: '@balajis', source: 'x' },
  { label: '@nntaleb', source: 'x' },
  { label: '@paulg', source: 'x' },
  { label: '@chrislhayes', source: 'x' },
  { label: '@zeynep', source: 'x' },
  { label: '@anildash', source: 'x' },
  { label: '@tylercowen', source: 'x' },
  { label: '@noahpinion', source: 'x' },
  { label: '@matthew_d_green', source: 'x' },
  { label: '@kelseyhightower', source: 'x' },
  { label: 'Studio Ghibli on Instagram', source: 'instagram' },
  { label: 'Tadao Ando Foundation', source: 'instagram' },
  { label: 'NASA on Instagram', source: 'instagram' },
  { label: 'Magnum Photos', source: 'instagram' },
  { label: 'World Press Photo', source: 'instagram' },
  { label: 'New Yorker Photo Booth', source: 'instagram' },
  { label: 'The Met', source: 'instagram' },
  { label: 'MoMA', source: 'instagram' },
  { label: 'Apartamento Magazine', source: 'instagram' },
  { label: 'Cereal Magazine', source: 'instagram' },
  { label: 'Kinfolk', source: 'instagram' },
  { label: 'Inside The Magic', source: 'youtube' },
  { label: 'Lex Fridman', source: 'youtube' },
  { label: 'Computerphile', source: 'youtube' },
]

/** Title patterns — chosen by source type so output reads plausibly. */
const TITLE_PATTERNS: Record<SourceType, ((f: Faker) => string)[]> = {
  blog: [
    (f) => `Notes on ${f.commerce.productAdjective().toLowerCase()} ${f.hacker.noun()}`,
    (f) => `Why ${f.company.buzzNoun()} is harder than it looks`,
    (f) => `A pattern for ${f.hacker.ingverb().toLowerCase()} ${f.hacker.noun()}`,
    (f) => `${f.person.firstName()}'s rules for ${f.hacker.noun()} design`,
    (f) => `What I learned from ${f.number.int({ min: 3, max: 12 })} years of ${f.hacker.noun()}`,
  ],
  newsletter: [
    (f) => `Issue #${f.number.int({ min: 8, max: 240 })} — ${f.company.catchPhrase()}`,
    (f) => `The ${f.commerce.productAdjective()} ${f.hacker.noun()} edition`,
    (f) => `${f.commerce.productAdjective()} takes on ${f.company.buzzNoun()}`,
    (f) => `${f.person.firstName()} ${f.person.lastName()} on ${f.hacker.noun()}`,
  ],
  news: [
    (f) => `${f.company.name()} announces ${f.commerce.productAdjective()} ${f.commerce.product()}`,
    (f) => `Inside ${f.company.name()}'s push into ${f.hacker.noun()}`,
    (f) =>
      `${f.location.city()}'s new ${f.hacker.noun()} sparks ${f.commerce.productAdjective()} debate`,
    (f) => `Why ${f.company.name()} is betting on ${f.company.buzzNoun()}`,
  ],
  youtube: [
    (f) => `How ${f.company.name()} builds ${f.commerce.product()}`,
    (f) =>
      `${f.commerce.productAdjective()} ${f.hacker.noun()} explained in ${f.number.int({ min: 5, max: 25 })} minutes`,
    (f) => `Inside the ${f.commerce.productAdjective()} ${f.hacker.noun()}`,
    (f) => `Why ${f.commerce.product()} is ${f.commerce.productAdjective()}`,
  ],
  instagram: [
    (f) =>
      `${f.location.city()} ${f.commerce.productAdjective().toLowerCase()} series, no. ${f.number.int({ min: 1, max: 40 })}`,
    (f) => `Studio visit — ${f.person.fullName()}`,
    (f) => `Detail study: ${f.commerce.productAdjective().toLowerCase()} ${f.hacker.noun()}`,
  ],
  x: [
    (f) => `Thread on ${f.hacker.noun()} ${f.hacker.verb()}ing`,
    (f) => `Quick take — ${f.company.catchPhrase()}`,
    (f) => `${f.commerce.productAdjective()} thoughts on ${f.company.buzzNoun()}`,
  ],
  website: [
    (f) => `${f.commerce.productAdjective()} ${f.hacker.noun()} — a primer`,
    (f) => `Field notes: ${f.location.country()} ${f.hacker.noun()}`,
    (f) => `${f.person.firstName()}'s collected ${f.hacker.noun()}`,
  ],
}

const CADENCE_OPTIONS = ['daily', 'twice-weekly', 'weekly', 'fortnightly'] as const

// --------------------------- Volume tuning ---------------------------

const TARGET_COUNT_MIN = 50
const TARGET_COUNT_MAX = 80
const BADGE_COUNT_MIN = 15
const BADGE_COUNT_MAX = 25
const ARTICLE_COUNT_MIN = 800
const ARTICLE_COUNT_MAX = 1200
const SUGGESTION_COUNT_MIN = 10
const SUGGESTION_COUNT_MAX = 20
const QUEUE_COUNT_MIN = 5
const QUEUE_COUNT_MAX = 10
const RUN_LOG_COUNT_MIN = 30
const RUN_LOG_COUNT_MAX = 50
const CRON_RUN_COUNT = 50

const FAKER_SEED = 42
const IMAGE_FETCH_CONCURRENCY = 12

// --------------------------- Idempotency ---------------------------

/**
 * Pure idempotency decision. Demo seeder skips when `targets` OR
 * `articles` has any non-zero row — either means somebody (real agent
 * runs OR a previous demo seed) has already filled the DB.
 *
 * Split from the DB-touching wrapper so it's directly unit-testable
 * without a Postgres dependency.
 */
export function decideSkip(
  targetCount: number,
  articleCount: number,
): { skip: boolean; reason: string } {
  if (targetCount > 0 || articleCount > 0) {
    return {
      skip: true,
      reason: `data already present (targets=${targetCount}, articles=${articleCount})`,
    }
  }
  return { skip: false, reason: '' }
}

/**
 * Cheap COUNT(*) probe + decideSkip.
 */
export async function shouldSkipDemoSeed(): Promise<{
  skip: boolean
  reason: string
  targetCount: number
  articleCount: number
}> {
  const [targetRow] = await db.select({ count: sql<number>`count(*)::int` }).from(targets)
  const [articleRow] = await db.select({ count: sql<number>`count(*)::int` }).from(articles)
  const targetCount = targetRow?.count ?? 0
  const articleCount = articleRow?.count ?? 0
  const decision = decideSkip(targetCount, articleCount)
  return { ...decision, targetCount, articleCount }
}

// --------------------------- Image-pipeline glue ---------------------------

/**
 * Resolve image-pipeline config from env, mirroring the mcp-store sidecar's
 * defaults. The seeder runs in the web container after migrations apply,
 * NOT in the mcp-store container — so we read MCP_IMAGE_DIR ourselves
 * (default `data/images`, which the docker-compose volume mount makes
 * shared between containers if both are mapped to the same volume).
 *
 * For the docker-compose stack as it stands today, the web container does
 * NOT mount mcp_images, so demo images land at /app/data/images inside
 * the web container and serve via mcp-store's image-serve route only if
 * the volume is also mounted on web. Operators who want demo images in
 * the dashboard should mount the volume on both web and mcp-store.
 */
function imagePipelineConfig() {
  return {
    imageDir: process.env.MCP_IMAGE_DIR ?? 'data/images',
    fetchTimeoutMs: Number(process.env.MCP_IMAGE_FETCH_TIMEOUT_MS ?? 10_000),
    maxBytes: Number(process.env.MCP_IMAGE_MAX_BYTES ?? 25 * 1024 * 1024),
    maxWidth: Number(process.env.MCP_IMAGE_MAX_WIDTH ?? 1600),
  }
}

const seedLogger = {
  info: (msg: string, fields?: Record<string, unknown>) => {
    if (msg === 'hero_image_stored') return // chatty; we log batch progress instead
    console.log(`[seed-demo] ${msg}`, fields ?? '')
  },
  warn: (msg: string, fields?: Record<string, unknown>) => {
    console.warn(`[seed-demo] ${msg}`, fields ?? '')
  },
}

// --------------------------- The seeder ---------------------------

export type SeedDemoResult = {
  skipped: boolean
  reason?: string
  inserted?: {
    targets: number
    topicBadges: number
    articles: number
    topicBadgeSuggestions: number
    queue: number
    runLog: number
    cronRuns: number
    heroImagesStored: number
    heroImagesFailed: number
  }
}

export async function seedDemo(): Promise<SeedDemoResult> {
  const skip = await shouldSkipDemoSeed()
  if (skip.skip) {
    console.log(`[seed-demo] skipping, ${skip.reason}`)
    return { skipped: true, reason: skip.reason }
  }

  const { faker } = await import('@faker-js/faker')
  faker.seed(FAKER_SEED)

  console.log('[seed-demo] starting demo seed (LUCIDINDEX_SEED_DEMO=true)...')

  // ---- agent token (synthetic byline owner for all demo articles) ----
  const [demoAgentToken] = await db
    .insert(agentTokens)
    .values({
      label: 'Demo Agent',
      // 64 hex chars of garbage — never used to authenticate anything; the
      // seeder just needs a row to satisfy FK on articles.agent_token_id.
      // The cleartext is unrecoverable (real argon2 hashes are 90+ chars
      // anyway) so this can never become a working credential.
      tokenHash: 'demo-seed-token-hash-not-a-real-credential',
    })
    .returning({ id: agentTokens.id })
  if (!demoAgentToken) throw new Error('failed to insert demo agent token')

  // ---- prompt_templates lookup (already seeded by seed.ts) ----
  const templateRows = await db
    .select({ id: promptTemplates.id, slug: promptTemplates.slug })
    .from(promptTemplates)
  const templateIdBySlug = new Map(templateRows.map((r) => [r.slug, r.id]))
  if (templateIdBySlug.size === 0) {
    throw new Error('[seed-demo] no prompt_templates found — seed.ts must run before seed-demo.ts')
  }

  // ---- topic_badges ----
  const badgeCount = faker.number.int({ min: BADGE_COUNT_MIN, max: BADGE_COUNT_MAX })
  const chosenBadges = faker.helpers.arrayElements(TOPIC_BADGE_POOL, badgeCount)
  const insertedBadges = await db
    .insert(topicBadges)
    .values(
      chosenBadges.map((name, i) => ({
        name,
        displayOrder: i,
      })),
    )
    .returning({ id: topicBadges.id, name: topicBadges.name })
  console.log(`[seed-demo] topic_badges: inserted ${insertedBadges.length}`)

  // ---- targets ----
  const targetCount = faker.number.int({ min: TARGET_COUNT_MIN, max: TARGET_COUNT_MAX })
  const chosenTargets = faker.helpers.arrayElements(TARGET_LABEL_POOL, targetCount)
  const targetRows: { id: string; label: string; source: SourceType }[] = []
  for (const t of chosenTargets) {
    const promptTemplateId = templateIdBySlug.get(t.source)
    if (!promptTemplateId) {
      console.warn(`[seed-demo] no prompt_template for source ${t.source}, skipping target`)
      continue
    }
    const cadence = faker.helpers.arrayElement(CADENCE_OPTIONS)
    // ~80% active, ~20% paused.
    const active = faker.number.float({ min: 0, max: 1 }) < 0.8
    const urlOrHandle =
      t.source === 'x' || t.source === 'instagram'
        ? t.label.startsWith('@')
          ? t.label
          : `@${faker.internet.username().toLowerCase()}`
        : `https://${faker.internet.domainName()}/`
    const nextDueAt = faker.date.soon({ days: 7 })
    const [row] = await db
      .insert(targets)
      .values({
        label: t.label,
        urlOrHandle,
        cadence,
        promptTemplateId,
        active,
        nextDueAt,
      })
      .returning({ id: targets.id })
    if (!row) continue
    targetRows.push({ id: row.id, label: t.label, source: t.source })
  }
  console.log(`[seed-demo] targets: inserted ${targetRows.length}`)

  // ---- queue items + run_log scaffolding ----
  //
  // Articles need a non-null run_log_id, which needs a non-null
  // queue_item_id. We build a bank of queue items + run_log rows up
  // front, then articles randomly attribute to one of those rows. This
  // mirrors the production flow where one queue pull → one run_log row →
  // many articles.
  const runLogCount = faker.number.int({ min: RUN_LOG_COUNT_MIN, max: RUN_LOG_COUNT_MAX })
  const runLogRows: { id: string; targetId: string }[] = []
  for (let i = 0; i < runLogCount; i++) {
    const t = faker.helpers.arrayElement(targetRows)
    const startedAt = faker.date.recent({ days: 30 })
    const completedAt = new Date(
      startedAt.getTime() + faker.number.int({ min: 1_000, max: 90_000 }),
    )
    // Insert a queue row first (acked, since the run is complete).
    const [qRow] = await db
      .insert(queue)
      .values({
        targetId: t.id,
        enqueuedAt: startedAt,
        claimedBy: demoAgentToken.id,
        lockedUntil: completedAt,
        ackedAt: completedAt,
      })
      .returning({ id: queue.id })
    if (!qRow) continue
    // ~10% failed runs to populate the System dashboard's failure counts.
    const status = faker.number.float({ min: 0, max: 1 }) < 0.1 ? 'failed' : 'succeeded'
    const [rlRow] = await db
      .insert(runLog)
      .values({
        targetId: t.id,
        queueItemId: qRow.id,
        agentTokenId: demoAgentToken.id,
        status,
        failureReason: status === 'failed' ? faker.hacker.phrase() : null,
        articlesCount: 0, // updated as articles attribute themselves
        startedAt,
        completedAt,
      })
      .returning({ id: runLog.id })
    if (rlRow) runLogRows.push({ id: rlRow.id, targetId: t.id })
  }
  console.log(`[seed-demo] run_log: inserted ${runLogRows.length}`)

  // ---- articles (the workhorse) ----
  const articleCount = faker.number.int({ min: ARTICLE_COUNT_MIN, max: ARTICLE_COUNT_MAX })
  console.log(`[seed-demo] articles: planning ${articleCount} rows + hero-image fetches`)

  const imgConfig = imagePipelineConfig()
  let heroSuccess = 0
  let heroFailed = 0
  let articlesInserted = 0

  // Pre-build the article payload so we can batch image fetches.
  type Plan = {
    targetId: string
    runLogId: string
    sourceUrl: string
    title: string
    summary: string
    agentDeepDive: string
    badges: string[]
    significance: 'small' | 'medium' | 'large'
    difficulty: 'easy' | 'medium' | 'hard'
    reasonablenessRating: number | null
    sourcePublishedAt: Date
    dashboardVisible: boolean
    hidden: boolean
    starred: boolean
    read: boolean
    imageSeed: string
  }

  const plans: Plan[] = []
  for (let i = 0; i < articleCount; i++) {
    const t = faker.helpers.arrayElement(targetRows)
    // Prefer a run_log from the same target if one exists; otherwise pick
    // any. (The schema lets articles cross-reference, but realism wants
    // them aligned.)
    const matchingRunLogs = runLogRows.filter((r) => r.targetId === t.id)
    const runLogPick =
      matchingRunLogs.length > 0
        ? faker.helpers.arrayElement(matchingRunLogs)
        : faker.helpers.arrayElement(runLogRows)
    if (!runLogPick) continue

    const titleFn = faker.helpers.arrayElement(TITLE_PATTERNS[t.source])
    const title = titleFn(faker)
    const summary = faker.helpers
      .multiple(() => faker.lorem.sentence({ min: 12, max: 22 }), { count: { min: 3, max: 5 } })
      .join(' ')
    const agentDeepDive = faker.helpers
      .multiple(() => faker.lorem.paragraph({ min: 3, max: 6 }), { count: { min: 2, max: 4 } })
      .join('\n\n')

    // Significance: ~10% large (Phase 5 large-tile variant), ~30% medium,
    // ~60% small.
    const sigRoll = faker.number.float({ min: 0, max: 1 })
    const significance: Plan['significance'] =
      sigRoll < 0.1 ? 'large' : sigRoll < 0.4 ? 'medium' : 'small'
    const difficulty = faker.helpers.arrayElement(['easy', 'medium', 'hard'] as const)

    // Recency-weighted publish date: 60% within last 30 days, 30% within
    // last 90, 10% within last 180.
    const daysAgo = (() => {
      const r = faker.number.float({ min: 0, max: 1 })
      if (r < 0.6) return faker.number.int({ min: 0, max: 30 })
      if (r < 0.9) return faker.number.int({ min: 31, max: 90 })
      return faker.number.int({ min: 91, max: 180 })
    })()
    const sourcePublishedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)

    const badgeNames = faker.helpers
      .arrayElements(insertedBadges, { min: 1, max: 3 })
      .map((b) => b.name)

    // Per-article uniqueness: source URL must be unique across the
    // (target, source_url) pair, and slug must be globally unique. faker
    // path is plenty random per call; we just have to make sure the URL
    // includes a seedable salt so re-runs reproduce.
    const urlSalt = faker.string.alphanumeric(8)
    const sourceUrl = `https://${faker.internet.domainName()}/${faker.lorem.slug()}-${urlSalt}`

    plans.push({
      targetId: t.id,
      runLogId: runLogPick.id,
      sourceUrl,
      title,
      summary,
      agentDeepDive,
      badges: badgeNames,
      significance,
      difficulty,
      reasonablenessRating: faker.number.int({ min: 1, max: 10 }),
      sourcePublishedAt,
      dashboardVisible: faker.number.float({ min: 0, max: 1 }) < 0.85,
      hidden: faker.number.float({ min: 0, max: 1 }) < 0.05,
      starred: faker.number.float({ min: 0, max: 1 }) < 0.05,
      read: faker.number.float({ min: 0, max: 1 }) < 0.4,
      imageSeed: faker.string.alphanumeric(10),
    })
  }

  // Slug uniqueness: generate per article, salt with index on conflict.
  // For demo data we don't run through @lucidindex/shared/slug — that
  // module is a hot dependency of mcp-store and we'd rather keep db clean
  // of the shared/slug dependency cycle. Instead, the seeder uses a
  // simple deterministic slug from the article index. Production code
  // path is unaffected.
  const slugFor = (i: number, plan: Plan): string => {
    const dateStr = plan.sourcePublishedAt.toISOString().split('T')[0]
    const titleSlug = plan.title
      .toLowerCase()
      .replace(/['‘’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
    return `${dateStr}-${titleSlug || 'article'}-d${i}`
  }

  // ---- image fetch + insert in batches ----
  for (let batchStart = 0; batchStart < plans.length; batchStart += IMAGE_FETCH_CONCURRENCY) {
    const batch = plans.slice(batchStart, batchStart + IMAGE_FETCH_CONCURRENCY)
    const imageResults = await Promise.all(
      batch.map((p) =>
        fetchAndStoreHeroImage(
          `https://picsum.photos/seed/${p.imageSeed}/1200/675`,
          imgConfig,
          seedLogger,
        ).catch((err: unknown) => ({
          ok: false as const,
          reason: err instanceof Error ? err.message : String(err),
        })),
      ),
    )
    // Insert articles — one row per plan, hero hash from the matching result.
    for (let j = 0; j < batch.length; j++) {
      const plan = batch[j]
      const result = imageResults[j]
      if (!plan || !result) continue
      const heroHash = result.ok ? result.hash : null
      if (result.ok) heroSuccess++
      else heroFailed++

      try {
        await db.insert(articles).values({
          targetId: plan.targetId,
          agentTokenId: demoAgentToken.id,
          runLogId: plan.runLogId,
          sourceUrl: plan.sourceUrl,
          slug: slugFor(batchStart + j, plan),
          title: plan.title,
          summary: plan.summary,
          agentDeepDive: plan.agentDeepDive,
          topicBadges: plan.badges,
          significance: plan.significance,
          difficulty: plan.difficulty,
          reasonablenessRating: plan.reasonablenessRating,
          sourcePublishedAt: plan.sourcePublishedAt,
          sourcePublishedAtEstimated: false,
          heroImageHash: heroHash,
          dashboardVisible: plan.dashboardVisible,
          hidden: plan.hidden,
          hiddenAt: plan.hidden ? new Date() : null,
          starred: plan.starred,
          read: plan.read,
          // jsonb crossSource — empty for demo data; the dashboard "other
          // coverage" UI degrades gracefully against an empty array.
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column shape
          crossSource: [] as any,
        })
        articlesInserted++
      } catch (err) {
        console.warn('[seed-demo] article insert failed', {
          slug: slugFor(batchStart + j, plan),
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if ((batchStart + batch.length) % 100 < IMAGE_FETCH_CONCURRENCY) {
      console.log(
        `[seed-demo] articles progress: ${batchStart + batch.length}/${plans.length} (hero ok=${heroSuccess}, fail=${heroFailed})`,
      )
    }
  }
  console.log(
    `[seed-demo] articles: inserted ${articlesInserted}/${plans.length} (hero ok=${heroSuccess}, fail=${heroFailed})`,
  )

  // Backfill run_log.articles_count from the inserted articles.
  await db.execute(sql`
    UPDATE run_log
    SET articles_count = sub.cnt
    FROM (
      SELECT run_log_id, COUNT(*)::int AS cnt FROM articles GROUP BY run_log_id
    ) sub
    WHERE run_log.id = sub.run_log_id
  `)

  // ---- topic_badge_suggestions (pending inbox) ----
  const suggestionCount = faker.number.int({ min: SUGGESTION_COUNT_MIN, max: SUGGESTION_COUNT_MAX })
  // Need real article rows to attribute suggestions to (FK).
  const someArticles = await db
    .select({ id: articles.id, targetId: articles.targetId })
    .from(articles)
    .limit(suggestionCount * 2)
  let suggestionsInserted = 0
  for (let i = 0; i < suggestionCount; i++) {
    const a = someArticles[i % someArticles.length]
    if (!a) break
    const name = faker.helpers.arrayElement([
      'AI Safety',
      'Generative Art',
      'Crypto Markets',
      'Web Standards',
      'Open Source',
      'Mental Models',
      'Sustainability',
      'Quantum Computing',
      'Behavioural Economics',
      'Visual Storytelling',
      'Cognitive Science',
      'Decentralised Web',
      'Climate Tech',
      'Maker Culture',
      'Monetary Policy',
      'Ethnography',
      'Biotech',
      'Game Design',
      'Linguistics',
      'Public Health',
    ])
    try {
      await db.insert(topicBadgeSuggestions).values({
        name: `${name} ${i}`, // disambiguate
        articleId: a.id,
        targetId: a.targetId,
        agentTokenId: demoAgentToken.id,
        count: faker.number.int({ min: 1, max: 8 }),
      })
      suggestionsInserted++
    } catch {
      // unique-name collision; skip.
    }
  }
  console.log(`[seed-demo] topic_badge_suggestions: inserted ${suggestionsInserted}`)

  // ---- live queue items (mixed claimed/unclaimed) ----
  const queueCount = faker.number.int({ min: QUEUE_COUNT_MIN, max: QUEUE_COUNT_MAX })
  let queueInserted = 0
  for (let i = 0; i < queueCount; i++) {
    const t = faker.helpers.arrayElement(targetRows)
    const claimed = faker.number.float({ min: 0, max: 1 }) < 0.4
    await db.insert(queue).values({
      targetId: t.id,
      enqueuedAt: faker.date.recent({ days: 1 }),
      claimedBy: claimed ? demoAgentToken.id : null,
      lockedUntil: claimed ? faker.date.soon({ days: 1 }) : null,
      ackedAt: null,
    })
    queueInserted++
  }
  console.log(`[seed-demo] queue (live): inserted ${queueInserted}`)

  // ---- cron_runs (System dashboard observability) ----
  const cronJobs = ['scheduler', 'reaper', 'purge', 'hwm_reset', 'local_backup'] as const
  let cronInserted = 0
  for (let i = 0; i < CRON_RUN_COUNT; i++) {
    const job = faker.helpers.arrayElement(cronJobs)
    const startedAt = faker.date.recent({ days: 30 })
    const completedAt = new Date(startedAt.getTime() + faker.number.int({ min: 50, max: 5_000 }))
    const status = faker.number.float({ min: 0, max: 1 }) < 0.95 ? 'succeeded' : 'failed'
    await db.insert(cronRuns).values({
      job,
      startedAt,
      completedAt,
      status,
      details: status === 'failed' ? { error: faker.hacker.phrase() } : { ok: true },
    })
    cronInserted++
  }
  console.log(`[seed-demo] cron_runs: inserted ${cronInserted}`)

  console.log('[seed-demo] demo seed complete.')

  return {
    skipped: false,
    inserted: {
      targets: targetRows.length,
      topicBadges: insertedBadges.length,
      articles: articlesInserted,
      topicBadgeSuggestions: suggestionsInserted,
      queue: queueInserted,
      runLog: runLogRows.length,
      cronRuns: cronInserted,
      heroImagesStored: heroSuccess,
      heroImagesFailed: heroFailed,
    },
  }
}

// ----------------------- Direct-run entrypoint -----------------------

const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    const url = new URL(`file://${entry}`).href
    return import.meta.url === url
  } catch {
    return false
  }
})()

if (isDirectRun) {
  seedDemo()
    .then((result) => {
      if (result.skipped) {
        console.log(`[seed-demo] skipped: ${result.reason}`)
      } else {
        console.log('[seed-demo] summary:', JSON.stringify(result.inserted, null, 2))
      }
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed-demo] failed:', err)
      process.exit(1)
    })
}
