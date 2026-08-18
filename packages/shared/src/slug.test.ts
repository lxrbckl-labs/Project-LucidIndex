/**
 * Tests for the slug lib (#65).
 *
 * These cover the contract that mcp-dashboard and the article-page route
 * both depend on: deterministic output, URL-safety, length cap, and a
 * stable disambiguator under collision.
 */

import { describe, expect, it } from 'vitest'
import { disambiguate, generateSlug } from './slug.js'

describe('generateSlug', () => {
  it('combines ISO date with a kebab-case title', () => {
    expect(generateSlug('Hello World', new Date('2026-04-26T12:00:00Z'))).toBe(
      '2026-04-26-hello-world',
    )
  })

  it('accepts an ISO string for the date', () => {
    expect(generateSlug('Hello World', '2026-04-26T12:00:00Z')).toBe('2026-04-26-hello-world')
  })

  it('strips apostrophes without inserting hyphens between letters', () => {
    expect(generateSlug("World's biggest fugue", '2026-04-26')).toBe(
      '2026-04-26-worlds-biggest-fugue',
    )
  })

  it('collapses punctuation runs into single hyphens', () => {
    expect(generateSlug('AI: a (very) long, dense — title!', '2026-04-26')).toBe(
      '2026-04-26-ai-a-very-long-dense-title',
    )
  })

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('!!! edge !!!', '2026-04-26')).toBe('2026-04-26-edge')
  })

  it('caps the title body at 80 chars', () => {
    const long = 'a'.repeat(200)
    const slug = generateSlug(long, '2026-04-26')
    // 11-char date prefix ("YYYY-MM-DD-") + 80-char body = 91 chars total.
    expect(slug).toHaveLength(91)
    expect(slug.startsWith('2026-04-26-')).toBe(true)
  })

  it('falls back to "article" on an empty title body', () => {
    expect(generateSlug('', '2026-04-26')).toBe('2026-04-26-article')
    expect(generateSlug('!!!', '2026-04-26')).toBe('2026-04-26-article')
  })

  it('is deterministic for the same inputs', () => {
    const a = generateSlug('repeat me', '2026-04-26')
    const b = generateSlug('repeat me', '2026-04-26')
    expect(a).toBe(b)
  })
})

describe('disambiguate', () => {
  it('appends a 6-char hex hash suffix', () => {
    const out = disambiguate('2026-04-26-hello', 'https://example.com/a')
    expect(out).toMatch(/^2026-04-26-hello-[0-9a-f]{6}$/)
  })

  it('is stable for the same source URL', () => {
    const a = disambiguate('2026-04-26-hello', 'https://example.com/a')
    const b = disambiguate('2026-04-26-hello', 'https://example.com/a')
    expect(a).toBe(b)
  })

  it('produces different suffixes for different source URLs', () => {
    const a = disambiguate('2026-04-26-hello', 'https://example.com/a')
    const b = disambiguate('2026-04-26-hello', 'https://example.com/b')
    expect(a).not.toBe(b)
  })
})
