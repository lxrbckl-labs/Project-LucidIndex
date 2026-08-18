'use client'

/**
 * Copy-to-clipboard button for the calibration-drift standing prompt (#77).
 * Rebuilt on shadcn Button + Sonner toast (Phase 2).
 */

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  text: string
}

export function CopyStandingPrompt({ text }: Props) {
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleCopy() {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        toast.success('Prompt copied to clipboard.')
        setTimeout(() => setCopied(false), 1500)
        return
      } catch {
        // Permissions denied — fall through to manual-select.
      }
    }
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        readOnly
        value={text}
        rows={2}
        data-testid="drift-standing-prompt"
        className="font-mono text-sm resize-none"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        data-testid="drift-copy-button"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
