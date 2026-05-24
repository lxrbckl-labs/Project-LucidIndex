'use client'

/**
 * Shared visibility state for the "ON THIS PAGE" TOC sidebar on forum
 * feed pages. Backed by localStorage so the preference persists across
 * reloads. Cross-tab sync uses the native `storage` event; same-tab sync
 * uses a custom `lucidindex:posts-toc-visibility` event dispatched on
 * every toggle (the `storage` event doesn't fire in the originating tab).
 */

import { useEffect, useState } from 'react'

const LS_KEY = 'lucidindex.posts-toc-visible'
const CUSTOM_EVENT = 'lucidindex:posts-toc-visibility'

function readLS(): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === null) return true // default: visible
    return raw === '1'
  } catch {
    return true
  }
}

function writeLS(value: boolean): void {
  try {
    localStorage.setItem(LS_KEY, value ? '1' : '0')
  } catch {
    // ignore
  }
}

export function usePostsTOCVisibility(): { visible: boolean; toggle: () => void } {
  // SSR-safe: always start true, then sync from localStorage on mount.
  const [visible, setVisible] = useState<boolean>(true)

  useEffect(() => {
    // Hydrate from localStorage on mount.
    setVisible(readLS())

    // Cross-tab sync — fires in every tab EXCEPT the one that wrote the value.
    function onStorage(e: StorageEvent) {
      if (e.key === LS_KEY) {
        setVisible(e.newValue === '1')
      }
    }

    // Same-tab sync — fired by `toggle()` below via dispatchEvent.
    function onCustom(e: Event) {
      const ce = e as CustomEvent<{ visible: boolean }>
      setVisible(ce.detail.visible)
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener(CUSTOM_EVENT, onCustom)

    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(CUSTOM_EVENT, onCustom)
    }
  }, [])

  function toggle() {
    const next = !readLS()
    writeLS(next)
    // Notify same-tab subscribers (storage event won't fire here).
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT, { detail: { visible: next } }))
  }

  return { visible, toggle }
}
