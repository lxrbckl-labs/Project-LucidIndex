'use client'

/**
 * article-prefs.ts — localStorage-backed article stars.
 *
 * Article stars are a guest-friendly, client-only preference: anyone can star
 * an article without signing in, exactly like starred topics and creators
 * (`topic-prefs.ts`). Stored as a JSON array of article ids under one key.
 * SSR-safe — every localStorage access is guarded for `window`.
 *
 *   localStorage key: lucidindex:starred-articles — Set<articleId>
 */

import { useCallback, useEffect, useState } from 'react'

export const STARRED_ARTICLES_KEY = 'lucidindex:starred-articles'

function readSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed as string[])
  } catch {
    return new Set()
  }
}

function writeSet(key: string, set: Set<string>): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(Array.from(set)))
}

export function getStarredArticles(): Set<string> {
  return readSet(STARRED_ARTICLES_KEY)
}

export function isArticleStarred(id: string): boolean {
  return readSet(STARRED_ARTICLES_KEY).has(id)
}

/** Toggle an article id in the starred set. Returns the new state (true = now starred). */
export function toggleStarredArticle(id: string): boolean {
  const set = readSet(STARRED_ARTICLES_KEY)
  const isNowStarred = !set.has(id)
  if (isNowStarred) {
    set.add(id)
  } else {
    set.delete(id)
  }
  writeSet(STARRED_ARTICLES_KEY, set)
  return isNowStarred
}

export type ArticleStars = {
  starred: Set<string>
  isStarred: (id: string) => boolean
  toggle: (id: string) => boolean
}

/**
 * useStarredArticles — hydrates the starred-article set from localStorage on
 * mount and keeps it in sync across tabs via the `storage` event.
 */
export function useStarredArticles(): ArticleStars {
  const [starred, setStarred] = useState<Set<string>>(new Set())

  useEffect(() => {
    setStarred(getStarredArticles())
    const onStorage = (e: StorageEvent) => {
      if (e.key === STARRED_ARTICLES_KEY) setStarred(getStarredArticles())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((id: string) => {
    const next = toggleStarredArticle(id)
    setStarred(new Set(getStarredArticles()))
    return next
  }, [])

  return { starred, isStarred: (id) => starred.has(id), toggle }
}
