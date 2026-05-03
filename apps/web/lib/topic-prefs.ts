'use client'

/**
 * topic-prefs.ts — localStorage helpers + React hook for topic preferences.
 *
 * Tracks two preference sets:
 *   - Starred topics  → user wants to follow/highlight these
 *   - Not-interested topics → user wants to hide articles tagged with these
 *
 * Both are stored as JSON arrays in localStorage.  SSR-safe: all localStorage
 * reads are guarded with `typeof window === 'undefined'` checks.
 *
 * Mutual exclusion: starring a not-interested topic removes it from
 * not-interested, and marking a starred topic as not-interested removes
 * it from starred.
 */

import { useCallback, useEffect, useState } from 'react'

export const STARRED_TOPICS_KEY = 'lucidindex:starred-topics'
export const NOT_INTERESTED_TOPICS_KEY = 'lucidindex:not-interested-topics'

// ---------------------------------------------------------------------------
// Pure helpers (no React)
// ---------------------------------------------------------------------------

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

export function getStarredTopics(): Set<string> {
  return readSet(STARRED_TOPICS_KEY)
}

export function getNotInterestedTopics(): Set<string> {
  return readSet(NOT_INTERESTED_TOPICS_KEY)
}

/**
 * Toggle a topic in the starred set.
 * If starring, also remove from not-interested (mutual exclusion).
 * Returns the new starred state (true = now starred).
 */
export function toggleStarredTopic(name: string): boolean {
  const starred = readSet(STARRED_TOPICS_KEY)
  const isNowStarred = !starred.has(name)

  if (isNowStarred) {
    starred.add(name)
    // mutual exclusion: remove from not-interested
    const notInterested = readSet(NOT_INTERESTED_TOPICS_KEY)
    if (notInterested.has(name)) {
      notInterested.delete(name)
      writeSet(NOT_INTERESTED_TOPICS_KEY, notInterested)
    }
  } else {
    starred.delete(name)
  }

  writeSet(STARRED_TOPICS_KEY, starred)
  return isNowStarred
}

/**
 * Toggle a topic in the not-interested set.
 * If marking not-interested, also remove from starred (mutual exclusion).
 * Returns the new not-interested state (true = now not-interested).
 */
export function toggleNotInterestedTopic(name: string): boolean {
  const notInterested = readSet(NOT_INTERESTED_TOPICS_KEY)
  const isNowNotInterested = !notInterested.has(name)

  if (isNowNotInterested) {
    notInterested.add(name)
    // mutual exclusion: remove from starred
    const starred = readSet(STARRED_TOPICS_KEY)
    if (starred.has(name)) {
      starred.delete(name)
      writeSet(STARRED_TOPICS_KEY, starred)
    }
  } else {
    notInterested.delete(name)
  }

  writeSet(NOT_INTERESTED_TOPICS_KEY, notInterested)
  return isNowNotInterested
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export type TopicPrefs = {
  starred: Set<string>
  notInterested: Set<string>
  toggleStar: (name: string) => void
  toggleNotInterested: (name: string) => void
}

/**
 * useTopicPrefs — React hook for reading and mutating topic preferences.
 *
 * Hydrates from localStorage on mount (client-only).  State updates
 * propagate back to localStorage immediately.
 */
export function useTopicPrefs(): TopicPrefs {
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [notInterested, setNotInterested] = useState<Set<string>>(new Set())

  // Hydrate from localStorage after mount (client-only)
  useEffect(() => {
    setStarred(getStarredTopics())
    setNotInterested(getNotInterestedTopics())
  }, [])

  const toggleStar = useCallback((name: string) => {
    toggleStarredTopic(name)
    // Re-read both sets after mutation (mutual exclusion may affect either)
    setStarred(new Set(getStarredTopics()))
    setNotInterested(new Set(getNotInterestedTopics()))
  }, [])

  const toggleNotInterested = useCallback((name: string) => {
    toggleNotInterestedTopic(name)
    setStarred(new Set(getStarredTopics()))
    setNotInterested(new Set(getNotInterestedTopics()))
  }, [])

  return { starred, notInterested, toggleStar, toggleNotInterested }
}
