'use client'

/**
 * Shared create/edit form for a Comparison Source.
 *
 * Mirrors TargetForm.tsx in structure: controlled state, fetch to
 * POST/PATCH, field-level error display.
 */

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ComparisonSourceFormInitial = {
  name: string
  baseUrl: string
  isActive: boolean
  notes: string
}

export type ComparisonSourceFormProps = {
  mode: 'create' | 'edit'
  sourceId?: string
  initial: ComparisonSourceFormInitial
}

type FieldErrors = Partial<Record<keyof ComparisonSourceFormInitial | '_form', string>>

export function ComparisonSourceForm({ mode, sourceId, initial }: ComparisonSourceFormProps) {
  const router = useRouter()

  const [name, setName] = useState(initial.name)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [isActive, setIsActive] = useState(initial.isActive)
  const [notes, setNotes] = useState(initial.notes)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})

    const payload = { name, baseUrl, isActive, notes: notes || null }
    const url =
      mode === 'create'
        ? '/api/settings/comparison-sources'
        : `/api/settings/comparison-sources/${sourceId}`
    const method = mode === 'create' ? 'POST' : 'PATCH'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok: true; id: string }
        | { ok: false; errors?: FieldErrors; error?: string }
        | null

      if (!res.ok || !data || data.ok === false) {
        const next: FieldErrors = (data && 'errors' in data && data.errors) || {
          _form: data && 'error' in data && data.error ? data.error : 'Save failed.',
        }
        setErrors(next)
        return
      }

      toast.success(mode === 'create' ? 'Source created.' : 'Source updated.')
      router.push('/settings/comparison-sources')
      router.refresh()
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Wikipedia"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
        />
        {errors.name && <span className="text-xs text-destructive">{errors.name}</span>}
      </div>

      {/* Base URL */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          required
          maxLength={500}
          placeholder="https://en.wikipedia.org"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={submitting}
          className="font-mono"
        />
        {errors.baseUrl && <span className="text-xs text-destructive">{errors.baseUrl}</span>}
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          maxLength={2000}
          rows={3}
          placeholder="Any context about when/how to use this source."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
        {errors.notes && <span className="text-xs text-destructive">{errors.notes}</span>}
      </div>

      {/* Active */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="isActive"
          checked={isActive}
          onCheckedChange={(val) => setIsActive(!!val)}
          disabled={submitting}
        />
        <Label htmlFor="isActive" className="font-normal cursor-pointer">
          Active (agents will consult this source)
        </Label>
      </div>

      {errors._form && (
        <p className="text-sm text-destructive" role="alert">
          {errors._form}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/settings/comparison-sources')}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
