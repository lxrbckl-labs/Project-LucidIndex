/**
 * Pure helpers for the Settings-layer extensions to `seed-demo.ts`
 * (LUCIDINDEX_SEED_DEMO=true). Split out so the small pieces of logic
 * that don't touch Postgres or the network can be unit-tested without a
 * DB or faker dependency.
 *
 * Round 8: extends the lived-in fixture so every Settings panel renders
 * populated. See `seed-demo.ts` for the wiring; this module only owns
 * the deterministic helpers.
 */

import { AGENT_OPINION_INSTRUCTION } from '@lucidindex/templates'

/** Realistic-feeling labels Alex would actually use for an agent token. */
export const DEMO_AGENT_TOKEN_LABELS: ReadonlyArray<{
  /** Label as it appears in Settings → Agent Tokens and as a byline. */
  label: string
  /** True iff this token should be revoked (revoked_at != null). */
  revoked: boolean
  /** Approximate age in days — used to vary `created_at` across the fixture. */
  ageDays: number
}> = [
  { label: 'Laptop Claude', revoked: false, ageDays: 88 },
  { label: 'Homelab Claude', revoked: false, ageDays: 71 },
  { label: 'iPhone reference', revoked: false, ageDays: 54 },
  { label: 'VPS Claude (paused)', revoked: true, ageDays: 41 },
  { label: 'Test sandbox', revoked: false, ageDays: 27 },
  { label: "Friend's experiment", revoked: false, ageDays: 14 },
  { label: 'Phone reading list', revoked: false, ageDays: 6 },
] as const

/**
 * Build the input rows for the additional `agent_tokens` insert. Pure —
 * `now` is injected so tests can assert deterministic created_at values.
 *
 * Returns labels + (created_at, revoked_at) timestamps. Caller pairs each
 * with a placeholder `tokenHash` and inserts.
 */
export function buildDemoAgentTokenLabels(now: Date): {
  label: string
  createdAt: Date
  revokedAt: Date | null
}[] {
  const dayMs = 24 * 60 * 60 * 1000
  return DEMO_AGENT_TOKEN_LABELS.map((entry) => {
    const createdAt = new Date(now.getTime() - entry.ageDays * dayMs)
    // Revoked tokens were revoked at some point AFTER creation but
    // before "now" — use the midpoint so the timestamp pair always
    // makes sense.
    const revokedAt = entry.revoked
      ? new Date(createdAt.getTime() + (entry.ageDays / 2) * dayMs)
      : null
    return { label: entry.label, createdAt, revokedAt }
  })
}

/**
 * Customized prompt-template variants Alex would plausibly create on top
 * of the starters. Slugs are distinct from the seven canonical starters
 * (which are owned by `@lucidindex/templates` STARTER_TEMPLATES) so the
 * INSERT can use ON CONFLICT (slug) DO NOTHING for idempotency.
 *
 * `crossSourceN` is varied across the variants on purpose — this is what
 * surfaces variety on the System dashboard's significance/difficulty
 * histogram and also makes the Templates panel look like the CRUD has
 * been used.
 *
 * Bodies are intentionally short — the goal is "this template was edited
 * by a human", not "this is a production template". Real production
 * tuning happens on the canonical starters.
 */
export const CUSTOMIZED_TEMPLATES: ReadonlyArray<{
  slug: string
  body: string
  crossSourceN: number
}> = [
  {
    slug: 'youtube-long-form',
    body:
      "Watching {{ creator_name }}'s long-form uploads only — anything under 20 minutes is\n" +
      'out of scope for this template. Skip Shorts, podcasts <20m, and live streams.\n' +
      '\n' +
      'For each upload past the high_water_mark:\n' +
      '  - Read the full description + chapter markers.\n' +
      '  - Summary should be 6-10 sentences (longer than the default — the form factor\n' +
      '    earns a longer write-up).\n' +
      '  - Cross-source ~{{ cross_source_n }} entries; prefer written companions to the video.\n' +
      AGENT_OPINION_INSTRUCTION,
    crossSourceN: 5,
  },
  {
    slug: 'newsletter-pre-summarized',
    body:
      'Reading {{ creator_name }} — already in newsletter-summary form, so do NOT re-summarize.\n' +
      'Quote the lede + the one-line takeaway and pass through the rest.\n' +
      '\n' +
      'Cross-source aggressively ({{ cross_source_n }}+) — newsletters are most valuable when\n' +
      'paired with primary-source coverage. Skip aggregator copies of this newsletter.\n' +
      AGENT_OPINION_INSTRUCTION,
    crossSourceN: 7,
  },
  {
    slug: 'blog-deep-essays',
    body:
      'Long-form essays from {{ creator_name }}. The deep-dive should run as long as the\n' +
      'piece justifies — do not truncate at the default length cap.\n' +
      '\n' +
      'Lead with the thesis, not the setup. Cross-source {{ cross_source_n }} entries from\n' +
      'independent voices on the same idea — this is the surface where cross-source pays off.\n' +
      AGENT_OPINION_INSTRUCTION,
    crossSourceN: 4,
  },
  {
    slug: 'x-thread-only',
    body:
      'Threads from {{ creator_name }} only — single tweets are out of scope.\n' +
      "Stitch the thread into a coherent paragraph; preserve the author's framing.\n" +
      '\n' +
      'Cross-source {{ cross_source_n }} entries; threads usually echo a current event so the\n' +
      'cross-source set should be the news entries that prompted the thread.\n' +
      AGENT_OPINION_INSTRUCTION,
    crossSourceN: 2,
  },
] as const

/**
 * Pure builder for the customized-template insert payload. Returns the
 * list verbatim — separated so downstream tests have a stable handle on
 * the same data the seeder writes.
 */
export function buildCustomizedTemplates(): ReadonlyArray<{
  slug: string
  body: string
  crossSourceN: number
}> {
  return CUSTOMIZED_TEMPLATES
}

/**
 * The `settings` schema (packages/db/schema/agent.ts) currently has only
 * two boolean/integer toggles + the off-site-backup pair. This helper
 * picks visibly-non-default values so Settings reflects "the admin has
 * touched configuration".
 *
 * Defaults (per schema):
 *   - strict_mode               = false
 *   - new_article_badge_hours   = 24
 *
 * Non-defaults chosen here:
 *   - strict_mode               = true
 *   - new_article_badge_hours   = 48 (longer "new" window)
 *
 * The off-site-backup pair is owned by a separate seeder section — kept
 * here only as the canonical reference for Phase 2 fields.
 */
export function chooseSettingsNonDefaults(): {
  strictMode: boolean
  newArticleBadgeHours: number
} {
  return {
    strictMode: true,
    newArticleBadgeHours: 48,
  }
}

/**
 * Pre-fill values for the Settings → Off-site backup panel. Marked as
 * clearly non-functional so a demo stack can never accidentally ship a
 * real backup. The remote name is picked to read like an rclone remote
 * (`<remote>:<bucket>`).
 */
export const DEMO_OFF_SITE_BACKUP_REMOTE = 'rclone-encrypted:lucidindex-offsite' as const
export const DEMO_OFF_SITE_BACKUP_CREDENTIALS_PLACEHOLDER =
  'DEMO_PLACEHOLDER_DO_NOT_RUN — replace via Settings → Off-site backup before any real shipment.' as const
