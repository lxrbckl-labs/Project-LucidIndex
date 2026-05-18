'use client'

/**
 * Settings → Forum → Posting client panel.
 *
 * Five labeled number inputs in a vertical form — one per configurable
 * post limit on the `forum_settings` singleton:
 *
 *   - Topics per post  (1-10,     default 3)
 *   - Images per post  (0-20,     default 1)
 *   - Title length     (1-500,    default 75)
 *   - Body length      (1-100000, default 5000)
 *   - Replies length   (1-100000, default 5000)
 *
 * The form holds string state per input (not numbers) so the user can
 * blank a field mid-edit without losing focus to a clamp; the strings
 * are parsed at Save time and the server is the final validator. A
 * destructive Alert surfaces any server-side validation error.
 *
 * Reset uses POST `/api/settings/posting/reset`, which writes the
 * canonical defaults back through the same upsert path Save uses. Alex
 * specifically wants the reset-to-canonical pattern preserved here.
 */

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type PostingPanelInitial = {
  maxTopicsPerPost: number
  maxImagesPerPost: number
  maxTitleChars: number
  maxBodyChars: number
  maxReplyChars: number
}

type FieldKey = keyof PostingPanelInitial

type FieldSpec = {
  key: FieldKey
  label: string
  hint: string
  min: number
  max: number
}

/**
 * Field definitions. The min/max mirror the DB CHECK ranges on
 * `forum_settings`; the browser's native number-input bounds give a
 * first cheap layer of validation and the server re-checks on submit.
 */
const FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'maxTopicsPerPost',
    label: 'Topics per post',
    hint: 'How many topic badges a single post may carry. 1–10. Default 3.',
    min: 1,
    max: 10,
  },
  {
    key: 'maxImagesPerPost',
    label: 'Images per post',
    hint: 'How many inline images a post may attach. 0–20. Default 1.',
    min: 0,
    max: 20,
  },
  {
    key: 'maxTitleChars',
    label: 'Title length',
    hint: 'Maximum characters in a post title. 1–500. Default 75.',
    min: 1,
    max: 500,
  },
  {
    key: 'maxBodyChars',
    label: 'Body length',
    hint: 'Maximum characters in a post body. 1–100,000. Default 5,000.',
    min: 1,
    max: 100_000,
  },
  {
    key: 'maxReplyChars',
    label: 'Replies length',
    hint: 'Maximum characters in a reply body. 1–100,000. Default 5,000.',
    min: 1,
    max: 100_000,
  },
]

const DEFAULTS: PostingPanelInitial = {
  maxTopicsPerPost: 3,
  maxImagesPerPost: 1,
  maxTitleChars: 75,
  maxBodyChars: 5000,
  maxReplyChars: 5000,
}

export function PostingPanel({ initial }: { initial: PostingPanelInitial }) {
  const router = useRouter()

  function toStringState(input: PostingPanelInitial): Record<FieldKey, string> {
    return {
      maxTopicsPerPost: String(input.maxTopicsPerPost),
      maxImagesPerPost: String(input.maxImagesPerPost),
      maxTitleChars: String(input.maxTitleChars),
      maxBodyChars: String(input.maxBodyChars),
      maxReplyChars: String(input.maxReplyChars),
    }
  }

  const [values, setValues] = useState<Record<FieldKey, string>>(toStringState(initial))
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField(key: FieldKey, raw: string) {
    setValues((v) => ({ ...v, [key]: raw }))
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Parse strings → numbers. Empty strings or non-numbers surface a
    // friendly client-side error before the round-trip.
    const parsed: PostingPanelInitial = { ...DEFAULTS }
    for (const f of FIELDS) {
      const raw = values[f.key].trim()
      if (raw === '') {
        setError(`${f.label} is required.`)
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        setError(`${f.label} must be a whole number.`)
        return
      }
      parsed[f.key] = n
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings/posting', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Save failed.')
        return
      }
      toast.success('Posting settings saved.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setError(null)
    setResetting(true)
    try {
      const res = await fetch('/api/settings/posting/reset', { method: 'POST' })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        row?: PostingPanelInitial
      }
      if (!res.ok || !data.ok || !data.row) {
        setError(data.error ?? 'Reset failed.')
        return
      }
      setValues(toStringState(data.row))
      toast.success('Posting settings reset to defaults.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.')
    } finally {
      setResetting(false)
    }
  }

  const busy = saving || resetting

  return (
    <form
      onSubmit={handleSave}
      className="mt-6 flex max-w-xl flex-col gap-6"
      data-testid="posting-panel"
    >
      {error && (
        <Alert variant="destructive" data-testid="posting-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <Label htmlFor={`posting-${f.key}`}>{f.label}</Label>
          <Input
            id={`posting-${f.key}`}
            type="number"
            inputMode="numeric"
            min={f.min}
            max={f.max}
            step={1}
            value={values[f.key]}
            onChange={(e) => setField(f.key, e.currentTarget.value)}
            disabled={busy}
            data-testid={`posting-input-${f.key}`}
          />
          <p className="text-xs text-muted-foreground">{f.hint}</p>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={busy} data-testid="posting-save">
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          disabled={busy}
          data-testid="posting-reset"
        >
          {resetting ? 'Resetting…' : 'Reset to defaults'}
        </Button>
      </div>
    </form>
  )
}
