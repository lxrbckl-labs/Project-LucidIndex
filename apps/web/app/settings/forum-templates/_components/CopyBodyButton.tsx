'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Props = {
  text: string
  label?: string
}

export function CopyBodyButton({ text, label = 'template' }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast.error('Clipboard not available.')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(`Copied ${label}.`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy.")
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className="absolute top-2 right-2 h-7 gap-1.5 px-2 text-xs"
    >
      {copied ? (
        <>
          <Check className="size-3.5" aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden="true" />
          Copy
        </>
      )}
    </Button>
  )
}
