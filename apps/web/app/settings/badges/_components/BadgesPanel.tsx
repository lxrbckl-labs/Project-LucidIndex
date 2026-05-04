'use client'

/**
 * Settings → Badges interactive panel — rebuilt on shadcn (Phase 2).
 *
 * Two stacked sections:
 *   1. Curated badges — list with inline edit. New Badges added via Dialog.
 *   2. Suggestion inbox — per-row Approve/Reject plus bulk-select actions.
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
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

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

export function BadgesPanel(props: BadgesPanelProps) {
  const { initialBadges, initialSuggestions } = props
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Badges</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Curated topic badges and the agent suggestion inbox.
        </p>
      </div>

      <Separator />

      <CuratedBadgesSection initialBadges={initialBadges} onAfterMutate={refresh} />

      <Separator />

      <SuggestionInboxSection
        initialSuggestions={initialSuggestions}
        selectedIds={selectedSuggestionIds}
        setSelectedIds={setSelectedSuggestionIds}
        onAfterMutate={refresh}
      />
    </div>
  )
}

/* ---------------------------- Curated badges --------------------------- */

function CuratedBadgesSection(props: { initialBadges: BadgeRow[]; onAfterMutate: () => void }) {
  const { initialBadges, onAfterMutate } = props
  const [newOpen, setNewOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Curated badges</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Badges are persistent — there is no delete in v0.1. Edit a badge to rename or restyle
            it.
          </p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button>New Badge</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Badge</DialogTitle>
            </DialogHeader>
            <BadgeFormContent
              mode="create"
              onCancel={() => setNewOpen(false)}
              onSuccess={() => {
                setNewOpen(false)
                toast.success('Badge created.')
                onAfterMutate()
              }}
              onError={(error) => toast.error(error)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialBadges.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No curated badges yet. Add one with the &ldquo;New Badge&rdquo; button above, or approve a
          suggestion below.
        </div>
      ) : (
        <ul className="divide-y border-y">
          {initialBadges.map((badge) => (
            <li key={badge.id} className="py-3">
              {editingId === badge.id ? (
                <BadgeFormContent
                  mode="edit"
                  badge={badge}
                  onCancel={() => setEditingId(null)}
                  onSuccess={() => {
                    setEditingId(null)
                    toast.success('Badge updated.')
                    onAfterMutate()
                  }}
                  onError={(error) => toast.error(error)}
                />
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {badge.color ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-sm border shrink-0"
                        style={{ backgroundColor: badge.color }}
                      />
                    ) : (
                      <span className="inline-block h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-sm font-semibold truncate">{badge.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      order: {badge.displayOrder ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 hidden md:inline">
                      added {formatDate(badge.createdAt)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(badge.id)}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BadgeFormContent(props: {
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
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`badge-name-${badge?.id ?? 'new'}`}>Name</Label>
        <Input
          id={`badge-name-${badge?.id ?? 'new'}`}
          type="text"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`badge-color-${badge?.id ?? 'new'}`}>Color</Label>
          <Input
            id={`badge-color-${badge?.id ?? 'new'}`}
            type="text"
            placeholder="#112233"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Hex value, optional.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`badge-order-${badge?.id ?? 'new'}`}>Order</Label>
          <Input
            id={`badge-order-${badge?.id ?? 'new'}`}
            type="number"
            step={1}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Lower values sort first.</p>
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/* --------------------------- Suggestion inbox --------------------------- */

function SuggestionInboxSection(props: {
  initialSuggestions: SuggestionRow[]
  selectedIds: Set<string>
  setSelectedIds: (s: Set<string>) => void
  onAfterMutate: () => void
}) {
  const { initialSuggestions, selectedIds, setSelectedIds, onAfterMutate } = props
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
  ): Promise<{ ok: boolean; error?: string }> {
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
      toast.error(result.error ?? 'Action failed.')
      return
    }
    toast.success(action === 'approve' ? 'Suggestion approved.' : 'Suggestion rejected.')
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
      toast.success(
        `${succeeded} suggestion${succeeded === 1 ? '' : 's'} ${
          action === 'approve' ? 'approved' : 'rejected'
        }.`,
      )
    } else {
      toast.error(`${succeeded} succeeded, ${errors.length} failed. ${errors[0] ?? ''}`)
    }
    onAfterMutate()
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Suggestion inbox</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Agents propose new badges via{' '}
          <code className="bg-muted px-1 rounded">write_articles</code>. Approve to add to the
          curated list, or reject to dismiss.
        </p>
      </div>

      {suggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No suggestions yet. Suggestions appear here when agents propose new badges via{' '}
          <code className="bg-muted px-1 rounded">write_articles</code>.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 border-b pb-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                id="select-all-suggestions"
                checked={allSelected}
                onCheckedChange={(val) => toggleAll(!!val)}
                aria-label="Select all suggestions"
              />
              <Label
                htmlFor="select-all-suggestions"
                className="font-normal cursor-pointer text-muted-foreground"
              >
                {selectedIds.size === 0 ? 'Select all' : `${selectedIds.size} selected`}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || selectedIds.size === 0}
                onClick={() => handleBulk('approve')}
              >
                Approve selected
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selectedIds.size === 0}
                onClick={() => handleBulk('reject')}
              >
                Reject selected
              </Button>
            </div>
          </div>

          <ul className="divide-y">
            {suggestions.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedIds.has(s.id)}
                    onCheckedChange={(val) => toggleOne(s.id, !!val)}
                    aria-label={`Select suggestion ${s.name}`}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ×{s.count} article{s.count === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        last seen {formatDate(s.lastSeenAt)}
                      </span>
                    </div>
                    {s.articleSlug && s.articleTitle ? (
                      <p className="mt-1 text-xs text-muted-foreground truncate">
                        first triggered by{' '}
                        <a
                          href={`/articles/${s.articleSlug}`}
                          className="underline hover:text-foreground"
                        >
                          {s.articleTitle}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => handleSingle(e, s.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => handleSingle(e, s.id, 'reject')}
                    >
                      Reject
                    </Button>
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
