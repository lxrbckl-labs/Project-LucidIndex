/**
 * Copy-to-clipboard button for the calibration-drift standing prompt (#77).
 *
 * Renders the prompt text in a read-only textarea (so admins can also
 * select-and-copy manually if the Clipboard API is blocked) plus a Copy
 * button that uses `navigator.clipboard.writeText`. After a successful
 * copy the label flips to "Copied" for 1.5s and reverts — the same
 * pattern other settings panels use for in-flight feedback.
 *
 * Falls back gracefully if `navigator.clipboard` is undefined (older
 * browsers or non-secure contexts): the button shows "Select & copy" and
 * focuses + selects the textarea, leaving the rest to the OS clipboard.
 */

'use client'

import { useRef, useState } from 'react'

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
        setTimeout(() => setCopied(false), 1500)
        return
      } catch {
        // Permissions denied or out of secure context — fall through to
        // the manual-select path below.
      }
    }
    // Fallback: focus + select all, let the user hit Cmd/Ctrl+C.
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        readOnly
        value={text}
        rows={2}
        data-testid="drift-standing-prompt"
        className="block w-full resize-none border border-neutral-300 bg-white px-3 py-2 text-sm font-mono text-neutral-800 focus:border-black focus:outline-none"
      />
      <button
        type="button"
        onClick={handleCopy}
        data-testid="drift-copy-button"
        className="text-xs uppercase tracking-wide border border-black px-3 py-1.5 hover:bg-black hover:text-white transition-colors"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
