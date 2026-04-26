/**
 * Settings → Hidden articles (Phase 7 — closes #78).
 *
 * Lists every article currently flagged `hidden = true` (the inverse
 * surface of the hide-action from Phase 6 #69) and exposes a Restore
 * affordance per row.
 *
 * Server component: queries directly. Auth is enforced upstream by
 * `apps/web/app/settings/layout.tsx` — every `/settings/*` route lives
 * behind the passkey gate. Each restore call also checks `requireAdmin`
 * defensively.
 *
 * Visibility note (documented for v0.1): hidden article URLs themselves
 * still 404 even for the admin (the article-page loader filters
 * `hidden = true` rows for everyone, including admins, by design — a
 * single visibility rule is easier to reason about than "admins see it,
 * everyone else doesn't"). The path back to the article is to restore
 * it from this panel.
 *
 * Mock mode: walks `mockArticles` and synthesizes a `hiddenAt` derived
 * from "now" so the timestamp column has a value to render. Mocks don't
 * carry a real `hidden_at` field today — search/restore semantics are
 * what's being demoed here, not the timestamp.
 */

import { db } from '@lucidindex/db/client'
import { desc, eq } from '@lucidindex/db/query'
import { articles } from '@lucidindex/db/schema'
import { mockArticles } from '@/app/_mock/articles'
import { RestoreButton } from './RestoreButton'

export const dynamic = 'force-dynamic'

const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

type HiddenRow = {
  id: string
  title: string
  slug: string
  hiddenAt: string | null
}

async function loadHiddenArticles(): Promise<HiddenRow[]> {
  if (MOCK_MODE) {
    // Synthesize hidden_at as "1 hour ago" for any mock flagged hidden.
    // Mocks don't persist hidden_at; this is purely for table rendering.
    const synthesizedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    return mockArticles
      .filter((a) => a.hidden === true)
      .map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        hiddenAt: synthesizedAt,
      }))
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      hiddenAt: articles.hiddenAt,
    })
    .from(articles)
    .where(eq(articles.hidden, true))
    .orderBy(desc(articles.hiddenAt))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
  }))
}

function formatHiddenAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // ISO-ish but human-readable; matches the editorial date treatment
  // used elsewhere (24. April 2026).
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  const year = d.getUTCFullYear()
  return `${day}. ${month} ${year}`
}

export default async function HiddenArticlesPanelPage() {
  const rows = await loadHiddenArticles()

  return (
    <div className="max-w-[960px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 7</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Hidden articles
      </h1>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />
      <p className="text-sm text-neutral-600 leading-relaxed mb-8">
        Articles you hid from the dashboard via the article page&apos;s &ldquo;Hide&rdquo; action
        (Phase 6 #69). Restoring an article puts it back on the dashboard immediately. Hidden URLs
        themselves 404 for everyone — the only path back is restore.
      </p>

      {rows.length === 0 ? <EmptyState /> : <HiddenTable rows={rows} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="border border-dashed border-neutral-300 px-6 py-12 text-center"
      data-testid="hidden-articles-empty"
    >
      <p className="text-sm text-neutral-600">No hidden articles.</p>
      <p className="mt-2 text-xs text-neutral-500">
        Hide articles from the article page itself; they&apos;ll show up here for restoration.
      </p>
    </div>
  )
}

function HiddenTable({ rows }: { rows: HiddenRow[] }) {
  return (
    <table className="w-full text-sm" data-testid="hidden-articles-table">
      <thead>
        <tr className="border-b border-neutral-200 text-left">
          <Th>Title</Th>
          <Th>Hidden at</Th>
          <Th className="text-right">Action</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200">
        {rows.map((row) => (
          <tr key={row.id} data-testid="hidden-article-row" data-article-id={row.id}>
            <Td>
              <span className="font-medium text-black">{row.title}</span>
              <span className="block text-xs text-neutral-500 font-mono">{row.slug}</span>
            </Td>
            <Td className="text-neutral-700 tabular-nums">{formatHiddenAt(row.hiddenAt)}</Td>
            <Td className="text-right">
              <RestoreButton articleId={row.id} />
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-3 text-xs uppercase tracking-wide text-neutral-500 ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-4 align-top ${className}`}>{children}</td>
}
