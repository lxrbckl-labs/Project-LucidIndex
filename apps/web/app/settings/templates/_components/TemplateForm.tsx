'use client'

/**
 * Shared create/edit form for a Prompt template — rebuilt on shadcn (Phase 2).
 *
 * Liquid syntax validation runs client-side on submit (fast feedback) and
 * server-side as defense-in-depth. The textarea is monospaced and roomy
 * because Liquid bodies are often 10-30 lines.
 */

import { validateLiquidSyntax } from '@lucidindex/templates'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type TemplateFormInitial = {
  slug: string
  body: string
  crossSourceN: number
}

export type TemplateFormProps = {
  mode: 'create' | 'edit'
  templateId?: string
  initial: TemplateFormInitial
  lockSlug?: boolean
}

type FieldErrors = Partial<Record<keyof TemplateFormInitial | '_form', string>>

export function TemplateForm(props: TemplateFormProps) {
  const { mode, templateId, initial, lockSlug = false } = props
  const router = useRouter()

  const [slug, setSlug] = useState(initial.slug)
  const [body, setBody] = useState(initial.body)
  const [crossSourceN, setCrossSourceN] = useState(initial.crossSourceN)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})

    // Client-side Liquid check first — fast, no server round-trip on a typo.
    const liquidError = validateLiquidSyntax(body)
    if (liquidError) {
      setErrors({ body: `Liquid syntax error: ${liquidError}` })
      setSubmitting(false)
      return
    }

    const payload = { slug, body, crossSourceN }
    const url =
      mode === 'create' ? '/api/settings/templates' : `/api/settings/templates/${templateId}`
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

      toast.success(mode === 'create' ? 'Template created.' : 'Template updated.')
      router.push('/settings/templates')
      router.refresh()
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Slug */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          type="text"
          required
          maxLength={80}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={lockSlug || submitting}
          className="font-mono disabled:bg-muted"
          placeholder="youtube"
          pattern="[a-z0-9][a-z0-9_-]*"
          title="Lowercase letters, digits, underscore, or hyphen. Must not start with a separator."
        />
        {lockSlug && (
          <p className="text-xs text-muted-foreground">
            Slug is locked on edit so existing target references stay stable.
          </p>
        )}
        {errors.slug && <span className="text-xs text-destructive">{errors.slug}</span>}
      </div>

      {/* Body (Liquid) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="body">Body (Liquid)</Label>
        <Textarea
          id="body"
          name="body"
          required
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={submitting}
          className="font-mono text-xs leading-relaxed"
          placeholder="You are watching {{ creator_name }} at {{ target_url }}..."
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Available variables: <code className="font-mono">creator_name</code>,{' '}
          <code className="font-mono">target_url</code>,{' '}
          <code className="font-mono">high_water_mark</code>,{' '}
          <code className="font-mono">cadence</code>,{' '}
          <code className="font-mono">cross_source_n</code>.
        </p>
        {errors.body && (
          <span className="text-xs text-destructive whitespace-pre-wrap" role="alert">
            {errors.body}
          </span>
        )}
      </div>

      {/* Cross-source N */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="crossSourceN">Cross-source N</Label>
        <Input
          id="crossSourceN"
          name="crossSourceN"
          type="number"
          required
          min={0}
          max={20}
          step={1}
          value={crossSourceN}
          onChange={(e) => setCrossSourceN(Number.parseInt(e.target.value, 10))}
          disabled={submitting}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          How many &ldquo;other coverage&rdquo; entries the agent should aim for. Default 3.
        </p>
        {errors.crossSourceN && (
          <span className="text-xs text-destructive">{errors.crossSourceN}</span>
        )}
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
          onClick={() => router.push('/settings/templates')}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
