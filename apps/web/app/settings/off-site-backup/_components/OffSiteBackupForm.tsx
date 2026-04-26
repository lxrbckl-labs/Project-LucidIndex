'use client'

/**
 * Off-site backup config form.
 *
 * Config-only — no rclone execution (Phase 7 #76 wires the cron job).
 *
 * Two fields:
 *   1. Remote name — the rclone remote the admin has configured outside this
 *      app (e.g. "b2-backup", "s3-prod", "nas-tailscale").
 *   2. Credentials blob — the full rclone config block for that remote,
 *      pasted in by the admin. Contains API keys / tokens — encrypted at rest
 *      with AES-256-GCM (key derived from IRON_SESSION_PASSWORD via HKDF).
 *
 * On mount the form fetches the current config via GET /api/settings/off-site-backup
 * so it pre-populates with whatever was previously saved.
 */

import { type FormEvent, useState } from 'react'

type FieldErrors = Partial<{
  remoteName: string
  credentialsBlob: string
  _form: string
}>

type Props = {
  /** Initial values loaded server-side and passed in as props. */
  initialRemoteName: string
  initialCredentialsBlob: string
}

export function OffSiteBackupForm({ initialRemoteName, initialCredentialsBlob }: Props) {
  const [remoteName, setRemoteName] = useState(initialRemoteName)
  const [credentialsBlob, setCredentialsBlob] = useState(initialCredentialsBlob)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    setSaved(false)

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

      setSaved(true)
    } catch {
      setErrors({ _form: 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-[560px]">
      {/* Remote name */}
      <Field label="Remote name" error={errors.remoteName} htmlFor="remoteName">
        <input
          id="remoteName"
          name="remoteName"
          type="text"
          maxLength={100}
          value={remoteName}
          onChange={(e) => {
            setRemoteName(e.target.value)
            setSaved(false)
          }}
          disabled={submitting}
          placeholder="e.g. b2-backup, s3-prod, nas-tailscale"
          className="w-full border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black disabled:opacity-50"
          data-testid="remote-name-input"
        />
        <p className="text-xs text-neutral-500 mt-1">
          The rclone remote name as configured in the host&apos;s rclone.conf (outside this app).
          Leave blank to disable off-site backup.
        </p>
      </Field>

      {/* Credentials blob */}
      <Field label="Credentials blob" error={errors.credentialsBlob} htmlFor="credentialsBlob">
        <textarea
          id="credentialsBlob"
          name="credentialsBlob"
          rows={10}
          value={credentialsBlob}
          onChange={(e) => {
            setCredentialsBlob(e.target.value)
            setSaved(false)
          }}
          disabled={submitting}
          placeholder={`[b2-backup]\ntype = b2\naccount = your-account-id\nkey = your-application-key`}
          className="w-full border border-neutral-300 px-3 py-2 text-xs font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-black disabled:opacity-50"
          data-testid="credentials-blob-input"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Paste the rclone config block for the remote above. Contains API keys — stored encrypted
          at rest (AES-256-GCM, key derived from your session secret via HKDF). Leave blank to omit
          from the DB and rely on the host&apos;s rclone config file or environment variables.
        </p>
      </Field>

      {/* Form-level error */}
      {errors._form ? (
        <div className="text-sm text-red-600" role="alert">
          {errors._form}
        </div>
      ) : null}

      {/* Saved confirmation */}
      {saved ? (
        <div
          className="text-sm text-emerald-700 border border-emerald-300 bg-emerald-50 px-3 py-2"
          role="status"
          data-testid="saved-banner"
        >
          Configuration saved.
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-black text-white text-sm font-semibold px-5 py-2 hover:opacity-80 disabled:opacity-40"
          data-testid="save-button"
        >
          {submitting ? 'Saving...' : 'Save configuration'}
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
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wide text-neutral-500 font-semibold"
      >
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
