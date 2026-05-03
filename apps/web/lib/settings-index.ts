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
    title: 'Add target',
    description: 'Configure a new ingestion source.',
    href: '/settings/targets/new',
    keywords: ['add', 'create', 'new', 'target', 'source'],
  },
  {
    title: 'Comparison sources',
    description: 'External citation pool — Wikipedia, AP, Reuters, etc.',
    href: '/settings/comparison-sources',
    keywords: ['citation', 'reference', 'external', 'compare'],
  },
  {
    title: 'Add comparison source',
    description: 'Add a new external source to the citation pool.',
    href: '/settings/comparison-sources/new',
    keywords: ['add', 'create', 'new', 'comparison', 'citation'],
  },
  {
    title: 'Templates',
    description: 'Prompt templates with Liquid validation.',
    href: '/settings/templates',
    keywords: ['prompt', 'template', 'liquid'],
  },
  {
    title: 'Add template',
    description: 'Author a new prompt template.',
    href: '/settings/templates/new',
    keywords: ['add', 'create', 'new', 'template', 'prompt'],
  },
  {
    title: 'Off-site backup',
    description: 'Configure the rclone remote that receives nightly DB dumps.',
    href: '/settings/off-site-backup',
    keywords: ['backup', 'rclone', 's3', 'remote', 'dump', 'restore'],
  },
  {
    title: 'System',
    description: 'Cron run history, queue depth, drift histograms.',
    href: '/settings/system',
    keywords: ['cron', 'queue', 'drift', 'observability', 'health'],
  },
  {
    title: 'Agent tokens',
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
]

export function searchSettingsIndex(query: string, limit = 5): SettingsIndexEntry[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  return SETTINGS_INDEX.filter((entry) => {
    const haystack = [entry.title, entry.description, ...entry.keywords].join(' ').toLowerCase()
    return haystack.includes(q)
  }).slice(0, limit)
}
