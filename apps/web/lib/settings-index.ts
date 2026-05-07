export type SettingsIndexEntry = {
  title: string
  description: string
  href: string
  keywords: string[]
}

export const SETTINGS_INDEX: ReadonlyArray<SettingsIndexEntry> = [
  {
    title: 'Overview',
    description: 'Settings hub.',
    href: '/settings',
    keywords: ['overview', 'hub', 'home'],
  },
  {
    title: 'Account',
    description: 'Passkeys, devices, recovery code.',
    href: '/settings/account',
    keywords: ['passkey', 'webauthn', 'recovery', 'device', 'login', 'security'],
  },
  {
    title: 'Targets',
    description: 'Sources the agent crawls — feeds, sites, ingestion.',
    href: '/settings/targets',
    keywords: ['source', 'feed', 'rss', 'ingestion', 'crawl', 'creator'],
  },
  {
    title: 'Comparison Sources',
    description: 'External citation pool — Wikipedia, AP, Reuters, etc.',
    href: '/settings/comparison-sources',
    keywords: ['citation', 'reference', 'external', 'compare'],
  },
  {
    title: 'Templates',
    description: 'Prompt templates with Liquid validation.',
    href: '/settings/templates',
    keywords: ['prompt', 'template', 'liquid'],
  },
  {
    title: 'System',
    description: 'Cron run history, queue depth, drift histograms.',
    href: '/settings/system',
    keywords: ['cron', 'queue', 'drift', 'observability', 'health'],
  },
  {
    title: 'Agent Tokens',
    description: 'Issue, hash, and revoke tokens for headless agents.',
    href: '/settings/agent-tokens',
    keywords: ['api', 'token', 'auth', 'agent', 'mcp'],
  },
  {
    title: 'Badges',
    description: 'Curated topic badges and the agent suggestion inbox.',
    href: '/settings/badges',
    keywords: ['topic', 'tag', 'category', 'badge'],
  },
  {
    title: 'Forum Invites',
    description: 'Generate single-use invite codes that gate forum signup.',
    href: '/settings/forum-invites',
    keywords: ['forum', 'invite', 'code', 'signup', 'gate'],
  },
]

// ─── Pre-tokenized index (built once at module load) ────────────────────────

type IndexedEntry = {
  entry: SettingsIndexEntry
  titleLower: string
  haystack: string // title + description + all keywords, lowercased
}

const INDEXED: ReadonlyArray<IndexedEntry> = SETTINGS_INDEX.map((entry) => ({
  entry,
  titleLower: entry.title.toLowerCase(),
  haystack: [entry.title, entry.description, ...entry.keywords].join(' ').toLowerCase(),
}))

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreEntry(indexed: IndexedEntry, q: string): number {
  const { titleLower, entry, haystack } = indexed

  // Title starts with query
  if (titleLower.startsWith(q)) return 100
  // Title contains query as a substring
  if (titleLower.includes(q)) return 60
  // Any keyword exactly equals query
  if (entry.keywords.some((k) => k.toLowerCase() === q)) return 30
  // Any keyword starts with query
  if (entry.keywords.some((k) => k.toLowerCase().startsWith(q))) return 20
  // Full haystack contains query as substring
  if (haystack.includes(q)) return 10

  return 0
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function searchSettingsIndex(query: string, limit = 5): SettingsIndexEntry[] {
  const q = query.trim().toLowerCase()

  // Browse mode: empty query returns all entries sorted alphabetically
  if (q.length === 0) {
    return [...SETTINGS_INDEX].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit)
  }

  // Minimum 1 char for settings (the index is tiny — 1-char matches are useful)
  if (q.length < 1) return []

  return INDEXED.flatMap((indexed) => {
    const score = scoreEntry(indexed, q)
    return score > 0 ? [{ score, entry: indexed.entry }] : []
  })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.entry.title.localeCompare(b.entry.title)
    })
    .slice(0, limit)
    .map((r) => r.entry)
}
