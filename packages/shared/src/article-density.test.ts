/**
 * Unit tests for the article content-density helpers.
 *
 * These cover the pure functions in `article-density.ts`:
 *   - `countWords`
 *   - `articleRenderableWords`
 *   - `effectiveCardSize`
 *
 * No DB, no rendering — all inputs are plain strings or nulls.
 */

import { describe, expect, it } from 'vitest'
import {
  articleRenderableWords,
  countWords,
  effectiveCardSize,
  MIN_LARGE_WORD_COUNT,
} from './article-density.js'

describe('countWords', () => {
  it('returns 0 for null', () => {
    expect(countWords(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(countWords(undefined)).toBe(0)
  })

  it('returns 0 for an empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for a punctuation-only string', () => {
    expect(countWords('!!! ... --- ???')).toBe(0)
  })

  it('counts a typical English sentence correctly', () => {
    // "The quick brown fox jumps over the lazy dog" → 9 words
    expect(countWords('The quick brown fox jumps over the lazy dog')).toBe(9)
  })

  it('counts contractions as one word (apostrophe glues the parts)', () => {
    // "don't" → 1, "it's" → 1, "they've" → 1
    expect(countWords("don't it's they've")).toBe(3)
  })

  it('handles Unicode accented letters (naïve résumé → 2 words)', () => {
    expect(countWords('naïve résumé')).toBe(2)
  })

  it('handles a longer body worth of text', () => {
    // 50 space-separated "word" tokens
    const text = Array.from({ length: 50 }, () => 'word').join(' ')
    expect(countWords(text)).toBe(50)
  })
})

describe('articleRenderableWords', () => {
  it('returns the summary word count when summary is present', () => {
    const article = { summary: 'Hello world this is a test sentence.' }
    // "Hello world this is a test sentence" → 7 words
    expect(articleRenderableWords(article)).toBe(7)
  })

  it('returns 0 when summary is null', () => {
    expect(articleRenderableWords({ summary: null })).toBe(0)
  })

  it('returns 0 when summary is undefined', () => {
    expect(articleRenderableWords({ summary: undefined })).toBe(0)
  })

  it('returns 0 when summary is an empty string', () => {
    expect(articleRenderableWords({ summary: '' })).toBe(0)
  })

  it('sums correctly for a multi-sentence summary', () => {
    const forty = Array.from({ length: 40 }, () => 'word').join(' ')
    expect(articleRenderableWords({ summary: forty })).toBe(40)
  })
})

describe('effectiveCardSize', () => {
  it('returns small when intent is small, regardless of word count', () => {
    const rich = { summary: Array.from({ length: 200 }, () => 'word').join(' ') }
    expect(effectiveCardSize(rich, 'small')).toBe('small')
  })

  it('returns small when intent is small and summary is null', () => {
    expect(effectiveCardSize({ summary: null }, 'small')).toBe('small')
  })

  it('returns small when intent is large but density is below threshold', () => {
    // MIN_LARGE_WORD_COUNT - 1 words → should demote
    const sparse = {
      summary: Array.from({ length: MIN_LARGE_WORD_COUNT - 1 }, () => 'word').join(' '),
    }
    expect(effectiveCardSize(sparse, 'large')).toBe('small')
  })

  it('returns small when intent is large but summary is null (zero words)', () => {
    expect(effectiveCardSize({ summary: null }, 'large')).toBe('small')
  })

  it('returns small when intent is large but summary is empty', () => {
    expect(effectiveCardSize({ summary: '' }, 'large')).toBe('small')
  })

  it('returns large when intent is large and density meets the threshold exactly', () => {
    const exact = {
      summary: Array.from({ length: MIN_LARGE_WORD_COUNT }, () => 'word').join(' '),
    }
    expect(effectiveCardSize(exact, 'large')).toBe('large')
  })

  it('returns large when intent is large and density exceeds the threshold', () => {
    const rich = {
      summary: Array.from({ length: MIN_LARGE_WORD_COUNT + 50 }, () => 'word').join(' '),
    }
    expect(effectiveCardSize(rich, 'large')).toBe('large')
  })
})
