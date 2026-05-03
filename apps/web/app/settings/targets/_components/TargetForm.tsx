'use client'

/**
 * Shared create/edit form for a Target — rebuilt on shadcn (Phase 2).
 *
 * Same fields, same submit semantics. The only difference is POST (create)
 * vs PATCH (edit). Validation echoes field-level errors from the JSON response.
 */

import { Check, ChevronsUpDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  targetId?: string
  initial: TargetFormInitial
  cadencePresets: ReadonlyArray<CadencePreset>
  promptTemplates: ReadonlyArray<{ id: string; slug: string }>
  promptTemplatesAvailable: boolean
}

type FieldErrors = Partial<Record<keyof TargetFormInitial | '_form', string>>

export function TargetForm(props: TargetFormProps) {
  const { mode, targetId, initial, cadencePresets, promptTemplates, promptTemplatesAvailable } =
    props
  const router = useRouter()

  const [label, setLabel] = useState(initial.label)
  const [urlOrHandle, setUrlOrHandle] = useState(initial.urlOrHandle)
  const [cadence, setCadence] = useState(initial.cadence || cadencePresets[0] || '')
  const [promptTemplateId, setPromptTemplateId] = useState(
    initial.promptTemplateId || promptTemplates[0]?.id || '',
  )
  const [active, setActive] = useState(initial.active)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

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

      toast.success(mode === 'create' ? 'Target created.' : 'Target updated.')
      router.push('/settings/targets')
      router.refresh()
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {!promptTemplatesAvailable && (
        <Alert>
          <AlertDescription>
            Create a prompt template first in{' '}
            <a className="underline" href="/settings/templates">
              Settings &rarr; Templates
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* Label + active toggle on the right */}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            name="label"
            type="text"
            required
            maxLength={200}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!promptTemplatesAvailable || submitting}
          />
          {errors.label && <span className="text-xs text-destructive">{errors.label}</span>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setActive(!active)}
              disabled={!promptTemplatesAvailable || submitting}
              aria-pressed={active}
              aria-label={active ? 'Pause target' : 'Activate target'}
              className="h-10 w-10 shrink-0 rounded-md border border-input bg-background hover:bg-accent flex items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {active ? (
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{active ? 'Watching' : 'Paused'}</TooltipContent>
        </Tooltip>
      </div>

      {/* URL or handle */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="urlOrHandle">URL or handle</Label>
        <Input
          id="urlOrHandle"
          name="urlOrHandle"
          type="text"
          required
          maxLength={500}
          value={urlOrHandle}
          onChange={(e) => setUrlOrHandle(e.target.value)}
          disabled={!promptTemplatesAvailable || submitting}
          className="font-mono"
          placeholder="https://example.com/feed.xml or @handle"
        />
        {errors.urlOrHandle && (
          <span className="text-xs text-destructive">{errors.urlOrHandle}</span>
        )}
      </div>

      {/* Cadence */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cadence">Cadence</Label>
        <Select
          value={cadence}
          onValueChange={setCadence}
          disabled={!promptTemplatesAvailable || submitting}
        >
          <SelectTrigger id="cadence">
            <SelectValue placeholder="Select cadence" />
          </SelectTrigger>
          <SelectContent>
            {cadencePresets.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {preset}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.cadence && <span className="text-xs text-destructive">{errors.cadence}</span>}
      </div>

      {/* Prompt template — searchable combobox */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="promptTemplateId">Prompt template</Label>
        <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              id="promptTemplateId"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={templatePickerOpen}
              disabled={!promptTemplatesAvailable || submitting}
              className="w-full justify-between font-normal"
            >
              {promptTemplates.find((t) => t.id === promptTemplateId)?.slug ??
                (promptTemplates.length === 0
                  ? 'No prompt templates available'
                  : 'Select template')}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search templates..." />
              <CommandList className="max-h-64 overflow-y-auto">
                <CommandEmpty>No template found.</CommandEmpty>
                <CommandGroup>
                  {promptTemplates.map((tpl) => (
                    <CommandItem
                      key={tpl.id}
                      value={tpl.slug}
                      onSelect={() => {
                        setPromptTemplateId(tpl.id)
                        setTemplatePickerOpen(false)
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          promptTemplateId === tpl.id ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                      {tpl.slug}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {errors.promptTemplateId && (
          <span className="text-xs text-destructive">{errors.promptTemplateId}</span>
        )}
      </div>

      {errors._form && (
        <p className="text-sm text-destructive" role="alert">
          {errors._form}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={!promptTemplatesAvailable || submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/settings/targets')}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
