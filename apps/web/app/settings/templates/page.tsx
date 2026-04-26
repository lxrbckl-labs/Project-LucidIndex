/**
 * Settings → Templates list view (RSC).
 *
 * Pulls every prompt template directly from the DB (server-side) and
 * renders a table with slug, cross_source_n, body excerpt, and updated_at.
 * Edit button hands off to `/settings/templates/[id]`.
 *
 * Functional-only styling — Phase 5 (#56) layers the Visual Identity on top
 * of every Settings panel in one pass. Sticking to plain Tailwind that
 * matches the rest of the Phase 1/2 settings shell.
 */

import Link from 'next/link'
import { listTemplates, type TemplateRow } from './_lib/templates-repo'

export const dynamic = 'force-dynamic'

const EXCERPT_LEN = 120

export default async function TemplatesPanelPage() {
  const templates = await listTemplates()

  return (
    <div className="max-w-[960px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <div className="flex items-baseline justify-between gap-4">
        <h1
          className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
          style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
        >
          Templates
        </h1>
        <Link
          href="/settings/templates/new"
          className="shrink-0 inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
        >
          New template
        </Link>
      </div>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />
      <p className="text-sm text-neutral-600 leading-relaxed mb-8">
        Liquid prompts the agent renders at queue-pull time. The starter set is seeded on first boot
        via <code className="font-mono">pnpm db:seed</code>; admins can fork or edit any of them.
      </p>

      {templates.length === 0 ? <EmptyState /> : <TemplatesTable rows={templates} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="border border-dashed border-neutral-300 px-6 py-12 text-center">
      <p className="text-sm text-neutral-600 mb-4">No templates yet.</p>
      <p className="text-xs text-neutral-500 mb-4">
        Run <code className="font-mono">pnpm db:seed</code> from the repo root to seed the 7 starter
        templates, or create your own.
      </p>
      <Link
        href="/settings/templates/new"
        className="inline-block bg-black text-white text-sm font-semibold px-4 py-2 hover:opacity-80"
      >
        Create your first template
      </Link>
    </div>
  )
}

function TemplatesTable({ rows }: { rows: TemplateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <Th>Slug</Th>
            <Th className="text-right">Cross-source N</Th>
            <Th>Body excerpt</Th>
            <Th>Updated</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-neutral-200 align-top">
              <Td className="font-mono text-xs font-semibold">{row.slug}</Td>
              <Td className="text-right tabular-nums">{row.crossSourceN}</Td>
              <Td className="text-xs text-neutral-700 max-w-[420px]">
                <span className="block truncate" title={row.body}>
                  {excerpt(row.body, EXCERPT_LEN)}
                </span>
              </Td>
              <Td className="text-xs text-neutral-600 whitespace-nowrap">
                {row.updatedAt.toISOString().replace('T', ' ').slice(0, 16)}
              </Td>
              <Td className="text-right whitespace-nowrap">
                <Link
                  href={`/settings/templates/${row.id}`}
                  className="text-sm font-semibold underline hover:opacity-70"
                >
                  Edit
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function excerpt(body: string, max: number): string {
  // Collapse interior whitespace so the excerpt reads as a single line.
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 font-semibold ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 ${className}`}>{children}</td>
}
