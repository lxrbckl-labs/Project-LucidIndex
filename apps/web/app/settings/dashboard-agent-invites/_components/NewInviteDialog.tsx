'use client'

/**
 * "New Invite" dialog — self-contained trigger + dialog island.
 *
 * Owns its own open state and router. On issue, the modal slides from a
 * label-only form pane to a share pane that shows the cleartext code
 * exactly once. When the dialog closes, the whole tree unmounts and the
 * cleartext is dropped from state — the only persistent record is the
 * argon2 hash on the server.
 *
 * Mirrors how `AddTargetDialog` renders as a self-contained trigger +
 * dialog island in the sub-header and empty state.
 */

import { Copy } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function NewInviteDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function handleIssued() {
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Invite</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <IssueModalContent onIssued={handleIssued} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Issue modal content
// ---------------------------------------------------------------------------

type IssueMode = 'form' | 'share'

function IssueModalContent({ onIssued, onClose }: { onIssued: () => void; onClose: () => void }) {
  // Two-pane slide: form (label input) → share (cleartext code + copy).
  // Cleartext only lives on this component's state — when the dialog
  // closes (either via Done or via the X / overlay click), this whole
  // tree unmounts and the cleartext is dropped.
  const [mode, setMode] = useState<IssueMode>('form')
  const [issuedLabel, setIssuedLabel] = useState('')
  const [issuedCode, setIssuedCode] = useState('')

  const formPaneRef = useRef<HTMLDivElement>(null)
  const sharePaneRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = mode === 'form' ? formPaneRef.current : sharePaneRef.current
    if (!node) return
    const update = () => {
      setTrackHeight(node.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-out"
      style={trackHeight !== undefined ? { height: trackHeight } : undefined}
    >
      <div
        className="flex items-start transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${mode === 'form' ? 0 : 100}%)` }}
      >
        <div ref={formPaneRef} className="w-full shrink-0" aria-hidden={mode !== 'form'}>
          <FormPane
            isActive={mode === 'form'}
            onIssued={(label, code) => {
              setIssuedLabel(label)
              setIssuedCode(code)
              setMode('share')
            }}
            onClose={onClose}
          />
        </div>
        <div ref={sharePaneRef} className="w-full shrink-0" aria-hidden={mode !== 'share'}>
          <SharePane label={issuedLabel} code={issuedCode} onDone={onIssued} />
        </div>
      </div>
    </div>
  )
}

function FormPane({
  isActive,
  onIssued,
  onClose,
}: {
  isActive: boolean
  onIssued: (label: string, code: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isActive) inputRef.current?.focus()
  }, [isActive])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Label is required.')
      inputRef.current?.focus()
      return
    }
    if (trimmed.length > 100) {
      setError('Label must be 100 characters or fewer.')
      inputRef.current?.focus()
      return
    }

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/dashboard-agent-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      })
      const data = (await res.json()) as { ok: true; code: string } | { ok: false; error?: string }
      if (!res.ok || !data.ok) {
        setError(
          data.ok === false ? (data.error ?? 'Failed to issue invite.') : 'Failed to issue invite.',
        )
        return
      }
      onIssued(trimmed, data.code)
    } catch {
      setError('Network error — invite was not issued.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New Invite</DialogTitle>
        <DialogDescription>
          Label the invite — you'll see the cleartext code next, exactly once.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 mt-4">
        <Input
          ref={inputRef}
          id="invite-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          required
          placeholder="for Alice's agent"
          className="focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Issue'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function SharePane({ label, code, onDone }: { label: string; code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const prompt = [
    "You've been invited to connect as a dashboard agent on LucidIndex.",
    '',
    `Invite code: ${code}`,
    `Token label: ${label}`,
    '',
    `Tool reference: ${origin}/agents/dashboard`,
    'This page documents the MCP tools available (pull queue items, write articles, manage target metadata, search the corpus), the bearer-token auth flow, and the connection URL.',
    '',
    "The invite code is single-use — once redeemed for a bearer token, it can't be reused. We can't retrieve it again.",
  ].join('\n')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast.success('Onboarding prompt copied to clipboard', {
        description:
          "The agent operator gets the invite code and docs link in one go. This is the only time you'll see the cleartext code.",
        duration: 8000,
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the prompt text and copy manually.')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save this code now</DialogTitle>
        <DialogDescription>
          Send <span className="font-semibold text-foreground">{label}</span> the code below. It's
          single-use — once redeemed for a bearer token, it can't be reused, and{' '}
          <span className="font-semibold text-foreground">we can't retrieve it again</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 mt-4">
        <code
          className="font-mono text-xs break-all bg-muted border border-border px-3 py-2 rounded select-all"
          data-testid="share-pane-code"
        >
          {code}
        </code>

        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Onboarding prompt</p>
          <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted border border-border px-3 py-2 rounded select-all">
            {prompt}
          </pre>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="flex-1"
            aria-label="Copy onboarding prompt"
          >
            <Copy className="h-4 w-4 mr-2" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" onClick={onDone} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    </>
  )
}
