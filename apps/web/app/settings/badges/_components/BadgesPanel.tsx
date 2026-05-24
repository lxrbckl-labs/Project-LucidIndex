'use client'

/**
 * Settings → Badges interactive panel — rebuilt on shadcn (Phase 2).
 *
 * Two stacked sections:
 *   1. Curated badges — list with inline edit. New Badges added via Dialog.
 *   2. Suggestion inbox — per-row Approve/Reject plus bulk-select actions.
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type BadgeRow = {
  id: string
  name: string
  displayOrder: number
  hidden: boolean
  createdAt: string
}

export type SuggestionRow = {
  id: string
  name: string
  count: number
  createdAt: string
  lastSeenAt: string
  articleId: string | null
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

  const [newOpen, setNewOpen] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Badges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curated topic badges and the agent suggestion inbox.
          </p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button size="sm">New Badge</Button>
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
                refresh()
              }}
              onError={(error) => toast.error(error)}
            />
          </DialogContent>
        </Dialog>
      </div>

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
  const [items, setItems] = useState<BadgeRow[]>(initialBadges)

  // Keep local order in sync when server-driven refresh fires (e.g. after edit / hide).
  useEffect(() => {
    setItems(initialBadges)
  }, [initialBadges])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function persistOrder(orderedIds: string[]) {
    try {
      const res = await fetch('/api/settings/badges/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: orderedIds }),
      })
      if (!res.ok) {
        toast.error('Could not save the new order.')
        onAfterMutate()
        return
      }
    } catch {
      toast.error('Network error.')
      onAfterMutate()
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((b) => b.id === active.id)
    const newIndex = items.findIndex((b) => b.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(items, oldIndex, newIndex)
    setItems(next)
    void persistOrder(next.map((b) => b.id))
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No curated badges yet. Add one with the &ldquo;New Badge&rdquo; button above, or approve a
        suggestion below.
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <span className="sr-only">Drag</span>
            </TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Edit</span>
            </TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Show / Hide</span>
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {items.map((badge) => (
              <BadgeTableRow key={badge.id} badge={badge} onAfterMutate={onAfterMutate} />
            ))}
          </SortableContext>
        </TableBody>
      </Table>
    </DndContext>
  )
}

function BadgeTableRow(props: { badge: BadgeRow; onAfterMutate: () => void }) {
  const { badge, onAfterMutate } = props
  const [editOpen, setEditOpen] = useState(false)
  const [hideBusy, setHideBusy] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: badge.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  async function toggleHidden() {
    if (hideBusy) return
    setHideBusy(true)
    try {
      const res = await fetch(`/api/settings/badges/${badge.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hidden: !badge.hidden }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update visibility.')
        return
      }
      toast.success(badge.hidden ? 'Badge shown on dashboard.' : 'Badge hidden from dashboard.')
      onAfterMutate()
    } catch {
      toast.error('Network error.')
    } finally {
      setHideBusy(false)
    }
  }

  return (
    <TableRow ref={setNodeRef} style={style} className={badge.hidden ? 'opacity-60' : undefined}>
      <TableCell className="w-8 cursor-grab touch-none" {...attributes} {...listeners}>
        <span
          className="inline-flex items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <GripVertical className="h-4 w-4" />
        </span>
      </TableCell>
      <TableCell className="w-10">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${badge.name}`}
              className="border border-input"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Badge</DialogTitle>
            </DialogHeader>
            <BadgeFormContent
              mode="edit"
              badge={badge}
              onCancel={() => setEditOpen(false)}
              onSuccess={() => {
                setEditOpen(false)
                toast.success('Badge updated.')
                onAfterMutate()
              }}
              onError={(error) => toast.error(error)}
            />
          </DialogContent>
        </Dialog>
      </TableCell>
      <TableCell className="w-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleHidden}
          disabled={hideBusy}
          aria-label={badge.hidden ? `Show ${badge.name}` : `Hide ${badge.name}`}
          className="border border-input"
        >
          {badge.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </TableCell>
      <TableCell className="font-semibold">{badge.name}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(badge.createdAt)}
      </TableCell>
    </TableRow>
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
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const url =
        mode === 'create' ? '/api/settings/badges' : `/api/settings/badges/${badge?.id ?? ''}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const payload: Record<string, unknown> = { name: name.trim() }

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

      <p className="text-xs text-muted-foreground">Order is set by drag-and-drop on the table.</p>

      <DialogFooter className="sm:justify-between">
        <Button size="sm" type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={submitting}>
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
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selectedIds.size === 0}
                onClick={() => handleBulk('reject')}
              >
                Reject
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
