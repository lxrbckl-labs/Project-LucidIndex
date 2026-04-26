'use client'

/**
 * Shared create / edit form for a Target.
 *
 * Same fields, same submit semantics — the only difference is whether we
 * POST to the collection endpoint (create) or PATCH the single-resource
 * endpoint (edit). The page wrapper picks the mode and redirects on success.
 *
 * Validation is mirrored on the server (`targets-repo.ts`); we only echo
 * field-level errors that come back in the JSON response.
 */

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import type { CadencePreset } from '../_lib/targets-repo'

export type TargetFormInitial = {
  label: string
  urlOrHandle: string
  cadence: string
  promptTemplateId: string
  active: boolean
}

export type TargetFormProps = {
  mode: 'create' | 'edit'
  /** Existing target id — required when mode === 'edit'. */
  targetId?: string
  initial: TargetFormInitial
  cadencePresets: ReadonlyArray<CadencePreset>
  promptTemplates: ReadonlyArray<{ id: string; slug: string }>
  /** When false, the form is disabled and a notice is shown above it. */
  promptTemplatesAvailable: boolean
}

type FieldErrors = Partial<Record<keyof TargetFormInitial | '_form', string>>

export function TargetForm(props: TargetFormProps) {
  const { mode, targetId, initial, cadencePresets, promptTemplates, promptTemplatesAvailable } =
    props
  const router = useRouter()

  const [label, setLabel] = useState(initial.label)
  const [urlOrHandle, setUrlOrHandle] = useState(initial.urlOrHandle)
  const [cadence, setCadence] = useState(initial.cadence || cadencePresets[0])
  const [promptTemplateId, setPromptTemplateId] = useState(
    initial.promptTemplateId || promptTemplates[0]?.id || '',
  )
  const [active, setActive] = useState(initial.active)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!promptTemplatesAvailable) return
    setSubmitting(true)
    setErrors({})

    const payload = { label, urlOrHandle, cadence, promptTemplateId, active }
    const url = mode === 'create' ? '/api/settings/targets' : `/api/settings/targets/${targetId}`
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

      router.push('/settings/targets')
      router.refresh()
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-[560px]">
      {!promptTemplatesAvailable ? (
        <div className="border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Create a prompt template first in{' '}
          <a className="underline" href="/settings/templates">
            Settings &rarr; Templates
          </a>
          .
        </div>
      ) : null}

      <Field label="Label" error={errors.label} htmlFor="label">
        <input
          id="label"
          name="label"
          type="text"
          required
          maxLength={200}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={!promptTemplatesAvailable || submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </Field>

      <Field label="URL or handle" error={errors.urlOrHandle} htmlFor="urlOrHandle">
        <input
          id="urlOrHandle"
          name="urlOrHandle"
          type="text"
          required
          maxLength={500}
          value={urlOrHandle}
          onChange={(e) => setUrlOrHandle(e.target.value)}
          disabled={!promptTemplatesAvailable || submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
          placeholder="https://example.com/feed.xml or @handle"
        />
      </Field>

      <Field label="Cadence" error={errors.cadence} htmlFor="cadence">
        <select
          id="cadence"
          name="cadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          disabled={!promptTemplatesAvailable || submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          {cadencePresets.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Prompt template" error={errors.promptTemplateId} htmlFor="promptTemplateId">
        <select
          id="promptTemplateId"
          name="promptTemplateId"
          value={promptTemplateId}
          onChange={(e) => setPromptTemplateId(e.target.value)}
          disabled={!promptTemplatesAvailable || submitting}
          className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          {promptTemplates.length === 0 ? (
            <option value="" disabled>
              No prompt templates available
            </option>
          ) : (
            promptTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.slug}
              </option>
            ))
          )}
        </select>
      </Field>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          disabled={!promptTemplatesAvailable || submitting}
          className="border border-neutral-300"
        />
        <span>Active (the cron sidecar will pick this up; uncheck to pause)</span>
      </label>

      {errors._form ? (
        <div className="text-sm text-red-600" role="alert">
          {errors._form}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!promptTemplatesAvailable || submitting}
          className="bg-black text-white text-sm font-semibold px-5 py-2 hover:opacity-80 disabled:opacity-40"
        >
          {submitting ? 'Saving...' : mode === 'create' ? 'Create target' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/settings/targets')}
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
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
