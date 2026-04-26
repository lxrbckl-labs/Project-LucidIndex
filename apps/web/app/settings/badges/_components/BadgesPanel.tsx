'use client'

/**
 * Settings → Badges interactive panel.
 *
 * Two stacked sections:
 *
 *   1. Curated badges — list of `topic_badges` rows with inline edit. New
 *      badges are added via a small form that toggles open under the
 *      section header. v0.1 has no delete (per NO DELETIONS); admins are
 *      told as much in the empty-state and the "Edit" form copy.
 *
 *   2. Suggestion inbox — list of unresolved `topic_badge_suggestions`
 *      with per-row Approve / Reject buttons AND a multi-select bulk-
 *      action affordance. Per the Round-7 spec, the bulk path is a
 *      client-side loop over the single-row endpoint — no batch endpoint
 *      yet (we revisit if/when the inbox gets noisy).
 *
 * Style is plain Tailwind via local `className`s rather than shadcn
 * components. Two reasons:
 *   - Adding shadcn components means pulling in `@radix-ui/*` deps, and
 *     the assignment forbids new deps.
 *   - The rest of `apps/web/app/settings/*` is already plain Tailwind
 *     (see `_components/PanelPlaceholder.tsx`, `LoginPanel.tsx`), so
 *     this matches the prevailing style and won't visually clash with a
 *     Phase-5 visual-identity pass.
 */

import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useMemo,
  useState,
  useTransition,
} from 'react'

export type BadgeRow = {
  id: string
  name: string
  color: string | null
  displayOrder: number | null
  createdAt: string
}

export type SuggestionRow = {
  id: string
  name: string
  count: number
  createdAt: string
  lastSeenAt: string
  articleId: string
  articleSlug: string | null
  articleTitle: string | null
}

export type BadgesPanelProps = {
  initialBadges: BadgeRow[]
  initialSuggestions: SuggestionRow[]
}

type Banner = { kind: 'error' | 'info'; message: string } | null

export function BadgesPanel(props: BadgesPanelProps) {
  const { initialBadges, initialSuggestions } = props
  const router = useRouter()
  const [banner, setBanner] = useState<Banner>(null)
  const [, startTransition] = useTransition()

  // Track which suggestions are checked for bulk actions. Set, not array,
  // so toggling is O(1) and we don't fight React reconciliation.
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  return (
    <div className="max-w-[840px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Badges
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />

      {banner ? (
        <div
          className={`mb-6 rounded border px-3 py-2 text-sm ${
            banner.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-neutral-200 bg-neutral-50 text-neutral-700'
          }`}
          role={banner.kind === 'error' ? 'alert' : 'status'}
        >
          {banner.message}
        </div>
      ) : null}

      <CuratedBadgesSection
        initialBadges={initialBadges}
        onAfterMutate={refresh}
        onBanner={setBanner}
      />

      <div className="mt-16 mb-8 h-px w-full bg-neutral-200" />

      <SuggestionInboxSection
        initialSuggestions={initialSuggestions}
        selectedIds={selectedSuggestionIds}
        setSelectedIds={setSelectedSuggestionIds}
        onAfterMutate={refresh}
        onBanner={setBanner}
      />
    </div>
  )
}

/* ---------------------------- Curated badges --------------------------- */

function CuratedBadgesSection(props: {
  initialBadges: BadgeRow[]
  onAfterMutate: () => void
  onBanner: (b: Banner) => void
}) {
  const { initialBadges, onAfterMutate, onBanner } = props
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black">Curated badges</h2>
        <button
          type="button"
          onClick={() => {
            setShowNewForm((s) => !s)
            setEditingId(null)
          }}
          className="text-xs font-medium uppercase tracking-wide border border-black px-3 py-1.5 hover:bg-black hover:text-white transition-colors"
        >
          {showNewForm ? 'Cancel' : 'New badge'}
        </button>
      </div>

      {showNewForm ? (
        <div className="mt-4 border border-neutral-200 p-4">
          <BadgeForm
            mode="create"
            onCancel={() => setShowNewForm(false)}
            onSuccess={() => {
              setShowNewForm(false)
              onBanner({ kind: 'info', message: 'Badge created.' })
              onAfterMutate()
            }}
            onError={(error) => onBanner({ kind: 'error', message: error })}
          />
        </div>
      ) : null}

      <p className="mt-4 text-xs text-neutral-500 leading-relaxed">
        Badges are persistent — there is no delete in v0.1. Edit a badge to rename or restyle it.
      </p>

      {initialBadges.length === 0 ? (
        <div className="mt-6 border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No curated badges yet. Add one with the "New badge" button above, or approve a suggestion
          below.
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200 border-t border-b border-neutral-200">
          {initialBadges.map((badge) => (
            <li key={badge.id} className="py-3">
              {editingId === badge.id ? (
                <BadgeForm
                  mode="edit"
                  badge={badge}
                  onCancel={() => setEditingId(null)}
                  onSuccess={() => {
                    setEditingId(null)
                    onBanner({ kind: 'info', message: 'Badge updated.' })
                    onAfterMutate()
                  }}
                  onError={(error) => onBanner({ kind: 'error', message: error })}
                />
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {badge.color ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-sm border border-neutral-300 shrink-0"
                        style={{ backgroundColor: badge.color }}
                      />
                    ) : (
                      <span className="inline-block h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-sm font-semibold text-black truncate">{badge.name}</span>
                    <span className="text-xs text-neutral-500 shrink-0">
                      order: {badge.displayOrder ?? '—'}
                    </span>
                    <span className="text-xs text-neutral-400 shrink-0 hidden md:inline">
                      added {formatDate(badge.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(badge.id)
                    }}
                    className="text-xs font-medium uppercase tracking-wide text-neutral-600 hover:text-black underline-offset-2 hover:underline"
                  >
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BadgeForm(props: {
  mode: 'create' | 'edit'
  badge?: BadgeRow
  onCancel: () => void
  onSuccess: () => void
  onError: (error: string) => void
}) {
  const { mode, badge, onCancel, onSuccess, onError } = props
  const [name, setName] = useState(badge?.name ?? '')
  const [color, setColor] = useState(badge?.color ?? '')
  const [displayOrder, setDisplayOrder] = useState(
    badge?.displayOrder !== undefined && badge.displayOrder !== null
      ? String(badge.displayOrder)
      : '',
  )
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const url =
        mode === 'create' ? '/api/settings/badges' : `/api/settings/badges/${badge?.id ?? ''}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const payload: Record<string, unknown> = { name: name.trim() }
      payload.color = color.trim() === '' ? null : color.trim()
      payload.displayOrder = displayOrder.trim() === '' ? null : Number(displayOrder)

      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !data.ok) {
        onError(data.error ?? `Could not ${mode === 'create' ? 'create' : 'update'} badge.`)
        return
      }
      onSuccess()
    } catch {
      onError('Network error. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end" onSubmit={handleSubmit}>
      <div className="md:col-span-5">
        <label
          htmlFor={`badge-name-${badge?.id ?? 'new'}`}
          className="block text-xs font-medium uppercase tracking-wide text-neutral-600 mb-1"
        >
          Name
        </label>
        <input
          id={`badge-name-${badge?.id ?? 'new'}`}
          type="text"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-black"
        />
      </div>
      <div className="md:col-span-3">
        <label
          htmlFor={`badge-color-${badge?.id ?? 'new'}`}
          className="block text-xs font-medium uppercase tracking-wide text-neutral-600 mb-1"
        >
          Color (hex, optional)
        </label>
        <input
          id={`badge-color-${badge?.id ?? 'new'}`}
          type="text"
          placeholder="#112233"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="block w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-black"
        />
      </div>
      <div className="md:col-span-2">
        <label
          htmlFor={`badge-order-${badge?.id ?? 'new'}`}
          className="block text-xs font-medium uppercase tracking-wide text-neutral-600 mb-1"
        >
          Order
        </label>
        <input
          id={`badge-order-${badge?.id ?? 'new'}`}
          type="number"
          step={1}
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
          className="block w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-black"
        />
      </div>
      <div className="md:col-span-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs font-medium uppercase tracking-wide bg-black text-white px-3 py-2 disabled:opacity-50"
        >
          {submitting ? 'Saving' : mode === 'create' ? 'Create' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium uppercase tracking-wide text-neutral-600 hover:text-black"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

/* --------------------------- Suggestion inbox --------------------------- */

function SuggestionInboxSection(props: {
  initialSuggestions: SuggestionRow[]
  selectedIds: Set<string>
  setSelectedIds: (s: Set<string>) => void
  onAfterMutate: () => void
  onBanner: (b: Banner) => void
}) {
  const { initialSuggestions, selectedIds, setSelectedIds, onAfterMutate, onBanner } = props
  const [busy, setBusy] = useState(false)

  const suggestions = initialSuggestions
  const allSelected = useMemo(
    () => suggestions.length > 0 && suggestions.every((s) => selectedIds.has(s.id)),
    [suggestions, selectedIds],
  )

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(suggestions.map((s) => s.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  async function resolveOne(
    id: string,
    action: 'approve' | 'reject',
  ): Promise<{
    ok: boolean
    error?: string
  }> {
    try {
      const res = await fetch(`/api/settings/badges/suggestions/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error ?? `Could not ${action} suggestion.` }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error.' }
    }
  }

  async function handleSingle(
    event: MouseEvent<HTMLButtonElement>,
    id: string,
    action: 'approve' | 'reject',
  ) {
    event.preventDefault()
    setBusy(true)
    const result = await resolveOne(id, action)
    setBusy(false)
    if (!result.ok) {
      onBanner({ kind: 'error', message: result.error ?? 'Action failed.' })
      return
    }
    onBanner({
      kind: 'info',
      message: action === 'approve' ? 'Suggestion approved.' : 'Suggestion rejected.',
    })
    // Drop this id from the selection set if it happened to be selected.
    if (selectedIds.has(id)) {
      const next = new Set(selectedIds)
      next.delete(id)
      setSelectedIds(next)
    }
    onAfterMutate()
  }

  async function handleBulk(action: 'approve' | 'reject') {
    if (selectedIds.size === 0) return
    setBusy(true)
    const ids = Array.from(selectedIds)
    let succeeded = 0
    const errors: string[] = []
    // Sequential — keeps Postgres load tame and lets us short-circuit if
    // a recurring error (e.g. duplicate-name on approve) is the same for
    // every row. Volume is expected to be low (a handful of suggestions
    // at a time), so the latency cost is negligible.
    for (const id of ids) {
      const result = await resolveOne(id, action)
      if (result.ok) {
        succeeded += 1
      } else if (result.error) {
        errors.push(result.error)
      }
    }
    setBusy(false)
    setSelectedIds(new Set())
    if (errors.length === 0) {
      onBanner({
        kind: 'info',
        message: `${succeeded} suggestion${succeeded === 1 ? '' : 's'} ${
          action === 'approve' ? 'approved' : 'rejected'
        }.`,
      })
    } else {
      // Surface the first error verbatim — duplicate-name is the most
      // useful one and is already specific.
      onBanner({
        kind: 'error',
        message: `${succeeded} succeeded, ${errors.length} failed. ${errors[0] ?? ''}`,
      })
    }
    onAfterMutate()
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-black">Suggestion inbox</h2>
      <p className="mt-2 text-xs text-neutral-500 leading-relaxed">
        Agents propose new badges via <code className="bg-neutral-100 px-1">write_articles</code>.
        Approve to add the badge to the curated list, or reject to dismiss the suggestion.
      </p>

      {suggestions.length === 0 ? (
        <div className="mt-6 border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No suggestions yet. Suggestions will appear here when agents propose new badges via
          <code className="bg-neutral-100 px-1 ml-1">write_articles</code>.
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between gap-4 border-y border-neutral-200 py-2 px-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
                aria-label="Select all suggestions"
                className="h-4 w-4 border-neutral-400"
              />
              {selectedIds.size === 0 ? 'Select all' : `${selectedIds.size} selected`}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || selectedIds.size === 0}
                onClick={() => handleBulk('approve')}
                className="text-xs font-medium uppercase tracking-wide bg-black text-white px-3 py-1.5 disabled:opacity-30"
              >
                Approve selected
              </button>
              <button
                type="button"
                disabled={busy || selectedIds.size === 0}
                onClick={() => handleBulk('reject')}
                className="text-xs font-medium uppercase tracking-wide border border-neutral-400 text-neutral-700 px-3 py-1.5 disabled:opacity-30 hover:border-black hover:text-black"
              >
                Reject selected
              </button>
            </div>
          </div>

          <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
            {suggestions.map((s) => (
              <li key={s.id} className="py-3 px-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={(e) => toggleOne(s.id, e.target.checked)}
                    aria-label={`Select suggestion ${s.name}`}
                    className="h-4 w-4 border-neutral-400 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-black">{s.name}</span>
                      <span className="text-xs text-neutral-500">
                        ×{s.count} article{s.count === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs text-neutral-400">
                        last seen {formatDate(s.lastSeenAt)}
                      </span>
                    </div>
                    {s.articleSlug && s.articleTitle ? (
                      <p className="mt-1 text-xs text-neutral-500 truncate">
                        first triggered by{' '}
                        <a
                          href={`/articles/${s.articleSlug}`}
                          className="underline hover:text-black"
                        >
                          {s.articleTitle}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => handleSingle(e, s.id, 'approve')}
                      className="text-xs font-medium uppercase tracking-wide bg-black text-white px-3 py-1.5 disabled:opacity-30"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => handleSingle(e, s.id, 'reject')}
                      className="text-xs font-medium uppercase tracking-wide border border-neutral-400 text-neutral-700 px-3 py-1.5 disabled:opacity-30 hover:border-black hover:text-black"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ------------------------------- helpers ------------------------------- */

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
