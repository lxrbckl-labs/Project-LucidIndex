'use client'

/**
 * Shared create / edit form for a Prompt template.
 *
 * Mirrors the structure of `<TargetForm>` so the two settings panels share
 * the same form ergonomics. Submit semantics differ only by mode: POST to
 * the collection on create, PATCH the single resource on edit.
 *
 * Liquid syntax validation runs in TWO places:
 *   1. Client-side here, on submit, via `validateLiquidSyntax` from
 *      `@lucidindex/templates`. Fast feedback, no round-trip.
 *   2. Server-side as defense-in-depth in the API route. The same package
 *      is the single source of truth for the rule.
 *
 * The textarea is monospaced and roomy because Liquid bodies are often
 * 10-30 lines and admins will be scanning whitespace-significant block
 * tags (`{% if %}`, etc.).
 */

import { validateLiquidSyntax } from '@lucidindex/templates'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

export type TemplateFormInitial = {
  slug: string
  body: string
  crossSourceN: number
}

export type TemplateFormProps = {
  mode: 'create' | 'edit'
  /** Existing template id — required when mode === 'edit'. */
  templateId?: string
  initial: TemplateFormInitial
  /** Lock the slug field on edit so existing references stay stable. */
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

    // Client-side Liquid check first — fast, no server round-trip on a
    // typo. The server re-validates as defense-in-depth.
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

      router.push('/settings/templates')
      router.refresh()
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-[720px]">
      <Field label="Slug" error={errors.slug} htmlFor="slug">
        <input
          id="slug"
          name="slug"
          type="text"
          required
          maxLength={80}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={lockSlug || submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black disabled:bg-neutral-100"
          placeholder="youtube"
          pattern="[a-z0-9][a-z0-9_-]*"
          title="Lowercase letters, digits, underscore, or hyphen. Must not start with a separator."
        />
        {lockSlug ? (
          <p className="text-xs text-neutral-500">
            Slug is locked on edit so existing target references stay stable.
          </p>
        ) : null}
      </Field>

      <Field label="Body (Liquid)" error={errors.body} htmlFor="body">
        <textarea
          id="body"
          name="body"
          required
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-black"
          placeholder="You are watching {{ creator_name }} at {{ target_url }}..."
          spellCheck={false}
        />
        <p className="text-xs text-neutral-500">
          Available variables: <code className="font-mono">creator_name</code>,{' '}
          <code className="font-mono">target_url</code>,{' '}
          <code className="font-mono">high_water_mark</code>,{' '}
          <code className="font-mono">cadence</code>,{' '}
          <code className="font-mono">cross_source_n</code>.
        </p>
      </Field>

      <Field label="Cross-source N" error={errors.crossSourceN} htmlFor="crossSourceN">
        <input
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
          className="w-32 border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <p className="text-xs text-neutral-500">
          How many "other coverage" entries the agent should aim for. Default 3.
        </p>
      </Field>

      {errors._form ? (
        <div className="text-sm text-red-600" role="alert">
          {errors._form}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="bg-black text-white text-sm font-semibold px-5 py-2 hover:opacity-80 disabled:opacity-40"
        >
          {submitting ? 'Saving...' : mode === 'create' ? 'Create template' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/settings/templates')}
          disabled={submitting}
          className="text-sm font-semibold underline hover:opacity-70 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string
  error?: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wide text-neutral-500 font-semibold"
      >
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs text-red-600 whitespace-pre-wrap" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
