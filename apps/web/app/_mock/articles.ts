/**
 * Mock article data for the Phase 5 visual foundation pass and the
 * Phase 5 visual gate (#63). Phase 6 (#64 / #65 / #66) extended the
 * shape with the fields the standalone article page needs:
 * `agentDeepDive`, `crossSource`, `reasonablenessRating`, and a
 * canonical `publishedAt` ISO timestamp that drives both the slug and
 * the date pill.
 *
 * Activation: `LUCIDINDEX_MOCK=1` (read in `app/page.tsx`). When unset,
 * the dashboard reads real articles from the DB via `loadDashboardArticles()`
 * (wired in #58 / Phase 5; placeholder for now).
 *
 * Why mocks live here, not in `packages/db/seed.ts`: the seed is for a
 * full local DB bootstrap. The visual gate runs against the fully-styled
 * dashboard with no DB at all (just `next dev` + the env flag), so we
 * need an in-process source.
 *
 * Significance distribution (12 articles):
 *   - 6 small  → 1×1 tiles
 *   - 4 medium → 1×2 tiles
 *   - 2 large  → 2×2 tiles (full-bleed image overlay variant — #59)
 *
 * The mix is deliberately weighted toward smalls so the masonry's
 * varied subdivisions read clearly per `Design/infinite_scroll.jpg`.
 *
 * Hero images: picsum.photos seeded URLs for stable, varied imagery
 * at the sizes the masonry needs. Black-and-white via `?grayscale=1`
 * matches the Fyrre reference (the spec also welcomes full-color
 * imagery — flip the `grayscale` query off if Alex prefers).
 */

import { generateSlug } from '@lucidindex/shared/slug'

export type Significance = 'small' | 'medium' | 'large'

/** A cross-source link rendered under "Other coverage" on the article page. */
export type MockCrossSource = {
  title: string
  source_url: string
  publisher?: string
}

export type MockArticle = {
  id: string
  /** `YYYY-MM-DD-<kebab-title>` — derived via `generateSlug` from #65. */
  slug: string
  title: string
  summary: string
  /**
   * Long-form analysis rendered on the article page (#66). May be
   * undefined for articles where the mock author didn't write a body —
   * the page renders a "no deep-dive yet" placeholder in that case.
   */
  agentDeepDive?: string
  topicBadges: string[]
  significance: Significance
  /** Pretty date for the date-pill (e.g. "16. April 2026"). */
  publishedLabel: string
  /** True when the agent estimated the publish date — UI prefixes "~". */
  publishedEstimated: boolean
  /** ISO publish timestamp — drives the slug and any deeper formatting. */
  publishedAt: string
  heroImageUrl: string
  /** Byline value — `agent_token.label`. */
  agentLabel: string
  /**
   * Creator (target) label — the source being analysed (e.g. "MKBHD").
   * Distinct from `agentLabel` (the analyst). Added in Phase 6 #71.
   */
  creatorLabel?: string
  /**
   * Creator slug for `/c/<slug>` links. Derived from the creator's
   * label + a stable created-at timestamp. Added in Phase 6 #71.
   */
  creatorSlug?: string
  /** Read-time estimate in minutes (rough: word_count / 250). */
  readMinutes: number
  /** 1-10 reasonableness rating; null when the agent skipped the field. */
  reasonablenessRating: number | null
  /** Bearish→bullish sentiment (-5..+5); null when the agent skipped it.
   * Drives the article page's Bearish/Bullish gauge. */
  sentiment?: number | null
  /** Cross-source list rendered under "Other coverage" on the article page. */
  crossSource: MockCrossSource[]
  /** Source URL — drives slug disambiguation and the cross-source link out. */
  sourceUrl: string
  /** True when the article should 404 — e2e/visual smoke for #69 hide. */
  hidden?: boolean
  /**
   * Mirrors `articles.dashboard_visible`. False means the article has
   * been rolled off the dashboard by the retention purge (#72) but is
   * still reachable via share-link and surfaced under "Include archived"
   * in the search UI (#73). Defaults to true for unflagged mocks.
   */
  dashboardVisible?: boolean
  /**
   * Hours-before-now to use as the synthetic agent-insertion timestamp
   * (`createdAt`) for the "NEW" badge (#79). Defaults to a large value
   * so the article reads as "old" — opt in by setting a small value
   * (< default 24h) on a couple of mocks to demo the badge.
   */
  insertedAtOffsetHours?: number
  /** Mock-mode runtime state (mutated by server actions in mock mode). */
  starred?: boolean
  read?: boolean
  /**
   * Real-DB-only field — populated by the dashboard loader's row mapper
   * with the actual `articles.created_at` so the "NEW" badge (#79)
   * reflects the agent-insertion timestamp on production data. Mock
   * articles continue to synthesize `created_at` via `insertedAtOffsetHours`,
   * which `getMockCreatedAt` consults as a fallback when this field is
   * absent.
   */
  createdAt?: Date
}

const HERO = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}?grayscale=1`

/**
 * Lorem-ish filler that's long enough to exercise the article page's
 * editorial layout but stops short of the 2000-word fair-use cap so
 * the truncation footer doesn't render on every mock. One mock article
 * (`m-001`) explicitly exceeds the cap to exercise the truncation
 * path in the visual gate.
 */
const LONG_BODY = `
The shift, when it came, did not announce itself. There was no single demo, no breathless keynote — just a quiet revision in the Chrome release notes and, two months later, a tide of independent ports that had been sitting in private repos waiting for the green light.

Most of those ports targeted the same handful of pain points: terrain rendering at the resolution the discipline now expects, particle systems that had outgrown the canvas-2D budget, and the long tail of CAD-style viewers that had been straining against WebGL's draw-call ceiling for half a decade. None of those are glamorous. All of them are load-bearing.

What's interesting is the second-order effect. Once the porting work began, teams rediscovered classes of optimization that had been dormant since the desktop-OpenGL era — multi-pass rendering pipelines, custom-baked tile maps, tessellation control over fixed function. Web teams had drifted toward shipping the simplest correct thing because anything more elaborate hit a performance cliff. WebGPU moves the cliff far enough out that the elaborate thing becomes worth it again.

That's not a small change. The shape of what an "advanced web frontend" means is shifting in real time, and the implications run through hiring, through tooling, through how teams talk about ownership of a graphics pipeline. The interview question "have you used WebGL?" used to be a filter for graphics specialists; now it's a baseline expectation, and the actual filter has moved up to "have you written a compute shader for the browser?" Which, until very recently, was a question with no honest yes-answer.

The handful of teams who can answer it now are visibly hiring against each other. Three of them shipped products that didn't exist six months ago. None of those products are demos — they're production tools that depend on compute shaders staying stable across releases. Stability is the next test, and the test isn't easy.

There's a second story underneath the first one — about how a standards process actually delivers something this scoped, after this many years of not-quite-delivering anything. The committee dynamics are worth their own piece. The short version is that a small number of people who had committed to seeing the spec through, paired with browser engineers who treated implementation as a mutual contract rather than a shipping risk, made the difference. That kind of social fact doesn't show up in the release notes either.

The release notes do contain one telling sentence: "Production stability for advanced rendering features." Buried in the middle of the page. Anodyne enough that you would skim past it. Worth a thousand words once you know what it costs to put there.
`.trim()

/** Helper — paste the long body N times to push past the fair-use cap. */
const VERY_LONG_BODY = Array.from({ length: 6 }, () => LONG_BODY).join('\n\n')

type MockSeed = Omit<MockArticle, 'slug'> & {
  /** Pretty date for the date-pill — co-derived with `publishedAt`. */
  publishedLabel: string
}

/** Build a `MockArticle` from a seed by deriving the slug deterministically. */
function fromSeed(seed: MockSeed): MockArticle {
  return {
    ...seed,
    slug: generateSlug(seed.title, seed.publishedAt),
  }
}

/**
 * Mock creators (targets) — the sources being analysed. Each creator has
 * a stable slug derived from their label + a fixed created-at timestamp
 * (the same `generateSlug` logic the DB lazy-backfill uses). Added for
 * Phase 6 #71 so creator-page click-throughs work in mock mode.
 *
 * Creator slugs are stable and deterministic — changing the label here
 * would break existing creator-page URLs, so treat these as locked once
 * shipped.
 */
const CREATORS = {
  webGraphics: { label: 'Web Graphics Lab', slug: 'web-graphics-lab', handle: '@webgfxlab' },
  skyWatch: { label: 'Sky Survey', slug: 'sky-survey', handle: '@skysurvey.bsky.social' },
  soundLab: { label: 'Sound Lab', slug: 'sound-lab', handle: '@soundlab.fm' },
  neuroRead: { label: 'Neuro Reader', slug: 'neuro-reader', handle: '@neuroreader.substack.com' },
  aiWatch: { label: 'AI Watch', slug: 'ai-watch', handle: '@aiwatch' },
  photoEssay: { label: 'Photo Essay', slug: 'photo-essay', handle: '@photoessay' },
  longnow: { label: 'Long Now Foundation', slug: 'long-now-foundation', handle: '@longnow.org' },
  fieldNotes: { label: 'Field Notes', slug: 'field-notes', handle: '@fieldnotes.science' },
  webStandards: {
    label: 'Web Standards Weekly',
    slug: 'web-standards-weekly',
    handle: '@webstandardsweekly.com',
  },
  statsNerd: { label: 'Stats Nerd', slug: 'stats-nerd', handle: '@statsnerd.substack.com' },
  policyBrief: { label: 'Policy Brief', slug: 'policy-brief', handle: '@policybrief' },
} as const

const seeds: MockSeed[] = [
  {
    id: 'm-001',
    title: 'WebGPU comes of age',
    summary:
      'A year after Chrome shipped it stable, WebGPU has graduated from research demo to production-grade rendering pipeline. Three engineers walk through the first real-world ports.',
    agentDeepDive: VERY_LONG_BODY,
    topicBadges: ['AI', 'GRAPHICS'],
    significance: 'large',
    publishedLabel: '24. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-24T12:00:00Z',
    heroImageUrl: HERO('lucid-001', 1600, 1000),
    agentLabel: 'compute-watch',
    creatorLabel: CREATORS.webGraphics.label,
    creatorSlug: CREATORS.webGraphics.slug,
    readMinutes: 8,
    reasonablenessRating: 8,
    crossSource: [
      {
        title: 'WebGPU stability landing in Chrome 120',
        source_url: 'https://example.com/chrome-blog/webgpu-stability',
        publisher: 'Chrome Releases',
      },
      {
        title: 'Compute shaders on the open web',
        source_url: 'https://example.com/web-graphics/compute-shaders',
        publisher: 'Web Graphics Lab',
      },
    ],
    sourceUrl: 'https://example.com/computewatch/webgpu-comes-of-age',
    // Demo the "NEW" badge (#79) — synthetic agent-insertion 2h ago.
    insertedAtOffsetHours: 2,
  },
  {
    id: 'm-002',
    title: 'Inside the Event Horizon collaboration',
    summary:
      'How a hundred radio observatories keep their atomic clocks aligned tightly enough to image a black hole — and what comes next as the array doubles in size.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['ASTRONOMY'],
    significance: 'medium',
    publishedLabel: '23. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-23T12:00:00Z',
    heroImageUrl: HERO('lucid-002', 800, 1000),
    agentLabel: 'sky-survey',
    creatorLabel: CREATORS.skyWatch.label,
    creatorSlug: CREATORS.skyWatch.slug,
    readMinutes: 6,
    reasonablenessRating: 7,
    crossSource: [
      {
        title: 'Atomic-clock synchronization in VLBI',
        source_url: 'https://example.com/vlbi/clocks',
        publisher: 'Astronomy Notes',
      },
    ],
    sourceUrl: 'https://example.com/skysurvey/event-horizon',
  },
  {
    id: 'm-003',
    title: 'The quiet revival of baroque counterpoint',
    summary:
      'Three composers releasing fugue cycles in 2026 — and what the practice still teaches about constraint as a creative engine.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['MUSIC'],
    significance: 'small',
    publishedLabel: '22. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-22T12:00:00Z',
    heroImageUrl: HERO('lucid-003', 800, 800),
    agentLabel: 'tonal-drift',
    creatorLabel: CREATORS.soundLab.label,
    creatorSlug: CREATORS.soundLab.slug,
    readMinutes: 4,
    reasonablenessRating: null,
    crossSource: [],
    sourceUrl: 'https://example.com/tonaldrift/baroque-counterpoint',
    // Demo the "NEW" badge (#79) — synthetic agent-insertion 8h ago.
    insertedAtOffsetHours: 8,
  },
  {
    id: 'm-004',
    title: 'Sleep is not a passive state',
    summary:
      'New tracer studies show the brain runs deliberate maintenance routines during slow-wave sleep that no waking process replicates. The implications for shift work are uncomfortable.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['NEURO'],
    significance: 'medium',
    publishedLabel: '21. April 2026',
    publishedEstimated: true,
    publishedAt: '2026-04-21T12:00:00Z',
    heroImageUrl: HERO('lucid-004', 800, 1000),
    agentLabel: 'mind-loop',
    creatorLabel: CREATORS.neuroRead.label,
    creatorSlug: CREATORS.neuroRead.slug,
    readMinutes: 7,
    reasonablenessRating: 6,
    crossSource: [
      {
        title: 'Slow-wave sleep tracer studies — 2026 review',
        source_url: 'https://example.com/neuro/slow-wave',
        publisher: 'Neural Review',
      },
    ],
    sourceUrl: 'https://example.com/mindloop/sleep-active',
  },
  {
    id: 'm-005',
    title: 'The economics of small language models',
    summary:
      'A 7B-parameter model that runs on a phone is not a smaller version of a 70B — it is a different product. A look at where the divergence shows up.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['AI'],
    significance: 'small',
    publishedLabel: '20. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-20T12:00:00Z',
    heroImageUrl: HERO('lucid-005', 800, 800),
    agentLabel: 'compute-watch',
    creatorLabel: CREATORS.aiWatch.label,
    creatorSlug: CREATORS.aiWatch.slug,
    readMinutes: 3,
    reasonablenessRating: 9,
    crossSource: [],
    sourceUrl: 'https://example.com/computewatch/small-language-models',
  },
  {
    id: 'm-006',
    title: 'Street photography after the model collapse',
    summary:
      'Generative imagery saturated stock libraries; the value of unstaged human moments rose accordingly. A field essay from six cities.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['ART', 'PHOTOGRAPHY'],
    significance: 'large',
    publishedLabel: '19. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-19T12:00:00Z',
    heroImageUrl: HERO('lucid-006', 1600, 1000),
    agentLabel: 'frame-finder',
    creatorLabel: CREATORS.photoEssay.label,
    creatorSlug: CREATORS.photoEssay.slug,
    readMinutes: 9,
    reasonablenessRating: 7,
    crossSource: [
      {
        title: 'Stock library saturation in 2026',
        source_url: 'https://example.com/photo/stock-saturation',
        publisher: 'Photo Quarterly',
      },
      {
        title: 'Field essays — six cities',
        source_url: 'https://example.com/photo/six-cities',
        publisher: 'Frame Notes',
      },
      {
        title: 'Unstaged moments and image markets',
        source_url: 'https://example.com/photo/unstaged',
        publisher: 'Image Economy',
      },
    ],
    sourceUrl: 'https://example.com/framefinder/street-photography-2026',
  },
  {
    id: 'm-007',
    title: 'Permacomputing, two years on',
    summary:
      'The manifesto called for a hundred-year computer. The community building toward it has tripled. What they have actually shipped.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['SYSTEMS'],
    significance: 'small',
    publishedLabel: '18. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-18T12:00:00Z',
    heroImageUrl: HERO('lucid-007', 800, 800),
    agentLabel: 'long-now',
    creatorLabel: CREATORS.longnow.label,
    creatorSlug: CREATORS.longnow.slug,
    readMinutes: 4,
    reasonablenessRating: null,
    crossSource: [],
    sourceUrl: 'https://example.com/longnow/permacomputing',
  },
  {
    id: 'm-008',
    title: 'Lichen as archive',
    summary:
      'A boreal-research team is reading air-pollution history off a single rock face. The chemistry is older than the cities the air came from.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['BIOLOGY'],
    significance: 'medium',
    publishedLabel: '17. April 2026',
    publishedEstimated: true,
    publishedAt: '2026-04-17T12:00:00Z',
    heroImageUrl: HERO('lucid-008', 800, 1000),
    agentLabel: 'field-notes',
    creatorLabel: CREATORS.fieldNotes.label,
    creatorSlug: CREATORS.fieldNotes.slug,
    readMinutes: 5,
    reasonablenessRating: 8,
    crossSource: [
      {
        title: 'Boreal lichens as pollution archives',
        source_url: 'https://example.com/biology/lichen-archive',
        publisher: 'Boreal Studies',
      },
    ],
    sourceUrl: 'https://example.com/fieldnotes/lichen-archive',
  },
  {
    id: 'm-009',
    title: 'Strange loops in CSS',
    summary:
      'Container queries plus `@scope` plus the `:has()` selector make CSS Turing-suggestive in ways the spec never planned for. Three patterns, one warning.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['WEB'],
    significance: 'small',
    publishedLabel: '16. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-16T12:00:00Z',
    heroImageUrl: HERO('lucid-009', 800, 800),
    agentLabel: 'render-tree',
    creatorLabel: CREATORS.webStandards.label,
    creatorSlug: CREATORS.webStandards.slug,
    readMinutes: 4,
    reasonablenessRating: 5,
    crossSource: [],
    sourceUrl: 'https://example.com/rendertree/strange-loops-css',
  },
  {
    id: 'm-010',
    title: 'Cargo-cult Bayes',
    summary:
      'Why "thinking in priors" became a Twitter performance — and what the underlying inference framework still does well when used honestly.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['STATISTICS'],
    significance: 'small',
    publishedLabel: '15. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-15T12:00:00Z',
    heroImageUrl: HERO('lucid-010', 800, 800),
    agentLabel: 'cold-take',
    creatorLabel: CREATORS.statsNerd.label,
    creatorSlug: CREATORS.statsNerd.slug,
    readMinutes: 3,
    reasonablenessRating: null,
    crossSource: [],
    sourceUrl: 'https://example.com/coldtake/cargo-cult-bayes',
  },
  {
    id: 'm-011',
    title: 'The orbital-debris treaty no one is signing',
    summary:
      'A draft framework has been on the table for eighteen months. The non-signers are not the countries you would guess.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['POLICY'],
    significance: 'medium',
    publishedLabel: '14. April 2026',
    publishedEstimated: false,
    publishedAt: '2026-04-14T12:00:00Z',
    heroImageUrl: HERO('lucid-011', 800, 1000),
    agentLabel: 'ground-truth',
    creatorLabel: CREATORS.policyBrief.label,
    creatorSlug: CREATORS.policyBrief.slug,
    readMinutes: 6,
    reasonablenessRating: 6,
    crossSource: [
      {
        title: 'Orbital-debris treaty draft text (2024)',
        source_url: 'https://example.com/policy/orbital-debris-draft',
        publisher: 'Policy Brief',
      },
    ],
    sourceUrl: 'https://example.com/groundtruth/orbital-debris',
  },
  {
    id: 'm-012',
    title: 'Modular synthesis goes quiet',
    summary:
      'After a decade of Eurorack maximalism, the most interesting builders are stripping back to four modules and calling it a record.',
    agentDeepDive: LONG_BODY,
    topicBadges: ['MUSIC'],
    significance: 'small',
    publishedLabel: '13. April 2026',
    publishedEstimated: true,
    publishedAt: '2026-04-13T12:00:00Z',
    heroImageUrl: HERO('lucid-012', 800, 800),
    agentLabel: 'tonal-drift',
    creatorLabel: CREATORS.soundLab.label,
    creatorSlug: CREATORS.soundLab.slug,
    readMinutes: 4,
    reasonablenessRating: null,
    crossSource: [],
    sourceUrl: 'https://example.com/tonaldrift/modular-quiet',
    // Demo the "Include archived" search toggle (#73) — this article is
    // off the dashboard but still findable via share-link / search-when-
    // archived-is-checked, mirroring the Phase 7 #72 retention purge.
    dashboardVisible: false,
  },
]

/**
 * Twelve mock articles, varied across significance + topic badges so
 * the masonry's curated patterns (see `ArticleMasonry.tsx`) all get
 * exercised in a single dashboard pass. Slugs are derived deterministically
 * via `@lucidindex/shared/slug` so the dashboard tile and the article
 * page agree on the canonical URL.
 */
export const mockArticles: MockArticle[] = seeds.map(fromSeed)

/**
 * Default age (in hours) used when a mock article doesn't set
 * `insertedAtOffsetHours`. Larger than any plausible "NEW" badge window
 * so unflagged mocks always read as "old" in the badge UI (#79).
 */
const DEFAULT_INSERTED_OFFSET_HOURS = 24 * 30

/**
 * Resolve the article's agent-insertion timestamp for the "NEW" badge
 * (#79). Three cases:
 *
 *   1. Real-DB row → returns the populated `createdAt` directly (the
 *      dashboard loader's row mapper sets it from `articles.created_at`).
 *   2. Mock with `insertedAtOffsetHours` → synthesizes "now − offset"
 *      so the visual gate can demo the badge without a DB.
 *   3. Mock without an offset → uses `DEFAULT_INSERTED_OFFSET_HOURS`
 *      so unflagged mocks read as "old".
 *
 * Despite the `Mock` prefix, this helper is the canonical NEW-badge
 * timestamp accessor for the dashboard — kept in this file because the
 * masonry's prop type is still `MockArticle[]` (renaming that view-model
 * is a follow-up).
 */
export function getMockCreatedAt(article: MockArticle): Date {
  if (article.createdAt) return article.createdAt
  const offsetHours = article.insertedAtOffsetHours ?? DEFAULT_INSERTED_OFFSET_HOURS
  return new Date(Date.now() - offsetHours * 60 * 60 * 1000)
}

/**
 * Returns the active dashboard article set. When `LUCIDINDEX_MOCK=1`
 * is set, this returns the `mockArticles` array; otherwise it returns
 * an empty array (the real-DB loader is wired in a later ticket).
 *
 * `LUCIDINDEX_MOCK_EMPTY=1` overrides `LUCIDINDEX_MOCK=1` and forces
 * the empty-array branch — used to screenshot the authenticated empty
 * state for the Phase 5 visual gate without setting up a full DB.
 *
 * Server components call this at render time — no client-side leaking
 * of mock data into the bundle when the env flag is off.
 */
export async function loadDashboardArticles(): Promise<MockArticle[]> {
  if (process.env.LUCIDINDEX_MOCK_EMPTY === '1') {
    return []
  }
  if (process.env.LUCIDINDEX_MOCK === '1') {
    // Mirror the real-DB loader's WHERE clause: hide hidden articles
    // and articles the retention purge has rolled off (`dashboard_visible
    // = false`). Both surface elsewhere — hidden via Settings → Hidden
    // articles (#78), archived via Search "Include archived" (#73).
    return mockArticles.filter((a) => !a.hidden && (a.dashboardVisible ?? true))
  }
  // Real DB loader will land alongside Phase 5 backend wiring; for the
  // visual-foundation PR we intentionally fall through to "empty" so
  // the empty-state design (#62) renders against an unflagged dev run.
  return []
}

/**
 * Mock creator view model — the minimal shape the creator page needs.
 * Added for Phase 6 #71. In real-DB mode the creator page joins `targets`.
 */
export type MockCreator = {
  label: string
  slug: string
  handle: string
}

/**
 * Find a mock creator by slug (#71). Returns null when no creator matches.
 * Used by the creator page under `LUCIDINDEX_MOCK=1`.
 */
export function findMockCreatorBySlug(slug: string): MockCreator | null {
  // Derive the list of unique creators from the current mock articles.
  // We look for `creatorSlug === slug` and return the first match.
  const article = mockArticles.find((a) => a.creatorSlug === slug)
  if (!article?.creatorLabel || !article.creatorSlug) return null
  // Look up the handle from the CREATORS const by matching label.
  // This is mock-only code — the handle is just for display.
  const handle =
    Object.values(CREATORS).find((c) => c.slug === slug)?.handle ?? article.creatorLabel
  return {
    label: article.creatorLabel,
    slug: article.creatorSlug,
    handle,
  }
}

/**
 * Return all visible mock articles scoped to a creator slug (#71). Filters
 * out hidden articles — consistent with the home-dashboard filter.
 */
export function findMockArticlesByCreatorSlug(creatorSlug: string): MockArticle[] {
  return mockArticles.filter((a) => a.creatorSlug === creatorSlug && !a.hidden)
}

/**
 * Returns the curated topic-badge list for the filter pill row (#55,
 * #61). In mock mode this is derived from the `mockArticles` set so
 * the filter pills always reflect the badges actually present on the
 * dashboard. Outside mock mode we'd hit the `topic_badges` table — the
 * real-DB path lands alongside Phase 5 backend wiring (sibling ticket).
 *
 * Order: stable insertion order based on first appearance in the
 * article queue, which gives a deterministic visual rhythm without
 * forcing alphabetic.
 */
export async function loadDashboardBadges(): Promise<string[]> {
  if (process.env.LUCIDINDEX_MOCK_EMPTY === '1') {
    return []
  }
  if (process.env.LUCIDINDEX_MOCK === '1') {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const article of mockArticles) {
      for (const badge of article.topicBadges) {
        if (!seen.has(badge)) {
          seen.add(badge)
          ordered.push(badge)
        }
      }
    }
    return ordered
  }
  return []
}

/**
 * Look up a single mock article by slug. Used by the article page (#64)
 * under `LUCIDINDEX_MOCK=1` so the route works against the visual-gate
 * dev server with no DB wiring. Returns `null` when no article matches
 * or the article is `hidden` — the route maps that to a 404.
 */
export function findMockArticleBySlug(slug: string): MockArticle | null {
  const found = mockArticles.find((a) => a.slug === slug && !a.hidden)
  return found ?? null
}
