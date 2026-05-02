'use client'

/**
 * Off-site backup config form — rebuilt on shadcn (Phase 2).
 *
 * Two fields:
 *   1. Remote name — the rclone remote the admin configured outside this app.
 *   2. Credentials blob — the full rclone config block (encrypted at rest).
 */

import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type FieldErrors = Partial<{
  remoteName: string
  credentialsBlob: string
  _form: string
}>

type Props = {
  initialRemoteName: string
  initialCredentialsBlob: string
}

export function OffSiteBackupForm({ initialRemoteName, initialCredentialsBlob }: Props) {
  const [remoteName, setRemoteName] = useState(initialRemoteName)
  const [credentialsBlob, setCredentialsBlob] = useState(initialCredentialsBlob)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})

    try {
      const res = await fetch('/api/settings/off-site-backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remoteName, credentialsBlob }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; errors?: FieldErrors; error?: string }
        | null

      if (!res.ok || !data || data.ok === false) {
        const next: FieldErrors = (data && 'errors' in data && data.errors) || {
          _form: data && 'error' in data && data.error ? data.error : 'Save failed.',
        }
        setErrors(next)
        return
      }

      toast.success('Configuration saved.')
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Remote name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remoteName">Remote name</Label>
        <Input
          id="remoteName"
          name="remoteName"
          type="text"
          maxLength={100}
          value={remoteName}
          onChange={(e) => setRemoteName(e.target.value)}
          disabled={submitting}
          placeholder="e.g. b2-backup, s3-prod, nas-tailscale"
          className="font-mono"
          data-testid="remote-name-input"
        />
        <p className="text-xs text-muted-foreground">
          The rclone remote name as configured in the host&apos;s rclone.conf (outside this app).
          Leave blank to disable off-site backup.
        </p>
        {errors.remoteName && (
          <span className="text-xs text-destructive" role="alert">
            {errors.remoteName}
          </span>
        )}
      </div>

      {/* Credentials blob */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="credentialsBlob">Credentials blob</Label>
        <Textarea
          id="credentialsBlob"
          name="credentialsBlob"
          rows={10}
          value={credentialsBlob}
          onChange={(e) => setCredentialsBlob(e.target.value)}
          disabled={submitting}
          placeholder={`[b2-backup]\ntype = b2\naccount = your-account-id\nkey = your-application-key`}
          className="font-mono text-xs leading-relaxed resize-y"
          data-testid="credentials-blob-input"
        />
        <p className="text-xs text-muted-foreground">
          Paste the rclone config block for the remote above. Contains API keys — stored encrypted
          at rest (AES-256-GCM). Leave blank to rely on the host&apos;s rclone config file.
        </p>
        {errors.credentialsBlob && (
          <span className="text-xs text-destructive" role="alert">
            {errors.credentialsBlob}
          </span>
        )}
      </div>

      {/* Form-level error */}
      {errors._form && (
        <p className="text-sm text-destructive" role="alert">
          {errors._form}
        </p>
      )}

      <div>
        <Button type="submit" disabled={submitting} data-testid="save-button">
          {submitting ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </form>
  )
}
