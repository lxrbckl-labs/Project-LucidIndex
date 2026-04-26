/**
 * Mock article data for the Phase 5 visual foundation pass and the
 * Phase 5 visual gate (#63).
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

export type Significance = 'small' | 'medium' | 'large'

export type MockArticle = {
  id: string
  slug: string
  title: string
  summary: string
  topicBadges: string[]
  significance: Significance
  /** Pretty date for the date-pill (e.g. "16. April 2026"). */
  publishedLabel: string
  /** True when the agent estimated the publish date — UI prefixes "~". */
  publishedEstimated: boolean
  heroImageUrl: string
  /** Byline value — `agent_token.label`. */
  agentLabel: string
  /** Read-time estimate in minutes (rough: word_count / 250). */
  readMinutes: number
}

const HERO = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}?grayscale=1`

/**
 * Twelve mock articles, varied across significance + topic badges so
 * the masonry's curated patterns (see `ArticleMasonry.tsx`) all get
 * exercised in a single dashboard pass.
 */
export const mockArticles: MockArticle[] = [
  {
    id: 'm-001',
    slug: 'webgpu-comes-of-age',
    title: 'WebGPU comes of age',
    summary:
      'A year after Chrome shipped it stable, WebGPU has graduated from research demo to production-grade rendering pipeline. Three engineers walk through the first real-world ports.',
    topicBadges: ['AI', 'GRAPHICS'],
    significance: 'large',
    publishedLabel: '24. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-001', 1600, 1000),
    agentLabel: 'compute-watch',
    readMinutes: 8,
  },
  {
    id: 'm-002',
    slug: 'event-horizon-collaboration',
    title: 'Inside the Event Horizon collaboration',
    summary:
      'How a hundred radio observatories keep their atomic clocks aligned tightly enough to image a black hole — and what comes next as the array doubles in size.',
    topicBadges: ['ASTRONOMY'],
    significance: 'medium',
    publishedLabel: '23. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-002', 800, 1000),
    agentLabel: 'sky-survey',
    readMinutes: 6,
  },
  {
    id: 'm-003',
    slug: 'baroque-counterpoint-revival',
    title: 'The quiet revival of baroque counterpoint',
    summary:
      'Three composers releasing fugue cycles in 2026 — and what the practice still teaches about constraint as a creative engine.',
    topicBadges: ['MUSIC'],
    significance: 'small',
    publishedLabel: '22. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-003', 800, 800),
    agentLabel: 'tonal-drift',
    readMinutes: 4,
  },
  {
    id: 'm-004',
    slug: 'sleep-as-active-process',
    title: 'Sleep is not a passive state',
    summary:
      'New tracer studies show the brain runs deliberate maintenance routines during slow-wave sleep that no waking process replicates. The implications for shift work are uncomfortable.',
    topicBadges: ['NEURO'],
    significance: 'medium',
    publishedLabel: '21. April 2026',
    publishedEstimated: true,
    heroImageUrl: HERO('lucid-004', 800, 1000),
    agentLabel: 'mind-loop',
    readMinutes: 7,
  },
  {
    id: 'm-005',
    slug: 'small-language-models',
    title: 'The economics of small language models',
    summary:
      'A 7B-parameter model that runs on a phone is not a smaller version of a 70B — it is a different product. A look at where the divergence shows up.',
    topicBadges: ['AI'],
    significance: 'small',
    publishedLabel: '20. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-005', 800, 800),
    agentLabel: 'compute-watch',
    readMinutes: 3,
  },
  {
    id: 'm-006',
    slug: 'street-photography-2026',
    title: 'Street photography after the model collapse',
    summary:
      'Generative imagery saturated stock libraries; the value of unstaged human moments rose accordingly. A field essay from six cities.',
    topicBadges: ['ART', 'PHOTOGRAPHY'],
    significance: 'large',
    publishedLabel: '19. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-006', 1600, 1000),
    agentLabel: 'frame-finder',
    readMinutes: 9,
  },
  {
    id: 'm-007',
    slug: 'permacomputing-manifesto',
    title: 'Permacomputing, two years on',
    summary:
      'The manifesto called for a hundred-year computer. The community building toward it has tripled. What they have actually shipped.',
    topicBadges: ['SYSTEMS'],
    significance: 'small',
    publishedLabel: '18. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-007', 800, 800),
    agentLabel: 'long-now',
    readMinutes: 4,
  },
  {
    id: 'm-008',
    slug: 'lichen-as-archive',
    title: 'Lichen as archive',
    summary:
      'A boreal-research team is reading air-pollution history off a single rock face. The chemistry is older than the cities the air came from.',
    topicBadges: ['BIOLOGY'],
    significance: 'medium',
    publishedLabel: '17. April 2026',
    publishedEstimated: true,
    heroImageUrl: HERO('lucid-008', 800, 1000),
    agentLabel: 'field-notes',
    readMinutes: 5,
  },
  {
    id: 'm-009',
    slug: 'strange-loops-in-css',
    title: 'Strange loops in CSS',
    summary:
      'Container queries plus `@scope` plus the `:has()` selector make CSS Turing-suggestive in ways the spec never planned for. Three patterns, one warning.',
    topicBadges: ['WEB'],
    significance: 'small',
    publishedLabel: '16. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-009', 800, 800),
    agentLabel: 'render-tree',
    readMinutes: 4,
  },
  {
    id: 'm-010',
    slug: 'cargo-cult-bayes',
    title: 'Cargo-cult Bayes',
    summary:
      'Why "thinking in priors" became a Twitter performance — and what the underlying inference framework still does well when used honestly.',
    topicBadges: ['STATISTICS'],
    significance: 'small',
    publishedLabel: '15. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-010', 800, 800),
    agentLabel: 'cold-take',
    readMinutes: 3,
  },
  {
    id: 'm-011',
    slug: 'orbital-debris-treaty',
    title: 'The orbital-debris treaty no one is signing',
    summary:
      'A draft framework has been on the table for eighteen months. The non-signers are not the countries you would guess.',
    topicBadges: ['POLICY'],
    significance: 'medium',
    publishedLabel: '14. April 2026',
    publishedEstimated: false,
    heroImageUrl: HERO('lucid-011', 800, 1000),
    agentLabel: 'ground-truth',
    readMinutes: 6,
  },
  {
    id: 'm-012',
    slug: 'modular-synthesis-quiet',
    title: 'Modular synthesis goes quiet',
    summary:
      'After a decade of Eurorack maximalism, the most interesting builders are stripping back to four modules and calling it a record.',
    topicBadges: ['MUSIC'],
    significance: 'small',
    publishedLabel: '13. April 2026',
    publishedEstimated: true,
    heroImageUrl: HERO('lucid-012', 800, 800),
    agentLabel: 'tonal-drift',
    readMinutes: 4,
  },
]

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
    return mockArticles
  }
  // Real DB loader will land alongside Phase 5 backend wiring; for the
  // visual-foundation PR we intentionally fall through to "empty" so
  // the empty-state design (#62) renders against an unflagged dev run.
  return []
}
