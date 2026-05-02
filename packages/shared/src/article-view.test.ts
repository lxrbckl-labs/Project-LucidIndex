/**
 * Unit tests for the pure article-view helpers consumed by the dashboard,
 * creator, search, and article-page loaders.
 *
 * These cover the row → view-model translation and the small shared
 * formatting helpers — i.e. the parts that don't need a DB. The
 * SQL-level filter / order / paging is exercised via the loader's own
 * integration coverage (Postgres-backed) and not duplicated here.
 */

import { describe, expect, it } from 'vitest'
import {
  type ArticleCardRow,
  decodeCrossSource,
  estimateCardReadMinutes,
  formatPublishLabel,
  heroImageUrlFromHash,
  mapArticleRowToCard,
} from './article-view.js'

describe('formatPublishLabel', () => {
  it('formats a UTC ISO timestamp as the editorial pill label', () => {
    expect(formatPublishLabel('2026-04-24T12:00:00Z')).toBe('24. April 2026')
  })

  it('uses UTC consistently regardless of host time zone', () => {
    // Midnight in Anchorage is the next day in UTC; we want the UTC date.
    expect(formatPublishLabel('2026-01-01T00:00:00Z')).toBe('1. January 2026')
  })

  it('returns the original string when the input is unparseable', () => {
    expect(formatPublishLabel('not-a-date')).toBe('not-a-date')
  })
})

describe('estimateCardReadMinutes', () => {
  it('floors to 1 minute for short summaries', () => {
    expect(estimateCardReadMinutes('Short summary.')).toBe(1)
  })

  it('rounds at 250 wpm', () => {
    // 750 words → 3 minutes
    const summary = Array.from({ length: 750 }, () => 'word').join(' ')
    expect(estimateCardReadMinutes(summary)).toBe(3)
  })

  it('returns 1 for an empty summary', () => {
    expect(estimateCardReadMinutes('')).toBe(1)
    expect(estimateCardReadMinutes('   ')).toBe(1)
  })
})

describe('heroImageUrlFromHash', () => {
  it('builds the /i/<hash> route URL', () => {
    expect(heroImageUrlFromHash('abc123')).toBe('/i/abc123')
  })

  it('returns empty string for a missing hash', () => {
    expect(heroImageUrlFromHash(null)).toBe('')
  })
})

describe('decodeCrossSource', () => {
  it('keeps entries with title + source_url and promotes optional publisher', () => {
    const decoded = decodeCrossSource([
      { title: 'A', source_url: 'https://x/a', publisher: 'X' },
      { title: 'B', source_url: 'https://x/b' }, // no publisher
    ])
    expect(decoded).toEqual([
      { title: 'A', source_url: 'https://x/a', publisher: 'X' },
      { title: 'B', source_url: 'https://x/b' },
    ])
  })

  it('drops malformed entries silently', () => {
    const decoded = decodeCrossSource([
      { title: 'OK', source_url: 'https://x/ok' },
      { title: 'no url' }, // missing source_url
      { source_url: 'https://x/no-title' }, // missing title
      null, // not an object
      'not-an-object',
    ])
    expect(decoded).toEqual([{ title: 'OK', source_url: 'https://x/ok' }])
  })

  it('returns an empty array for a non-array input', () => {
    expect(decodeCrossSource(null)).toEqual([])
    expect(decodeCrossSource(undefined)).toEqual([])
    expect(decodeCrossSource({})).toEqual([])
  })
})

describe('mapArticleRowToCard', () => {
  const baseRow: ArticleCardRow = {
    id: 'a1',
    slug: '2026-04-24-webgpu',
    title: 'WebGPU comes of age',
    summary: 'A short summary of the article.',
    topicBadges: ['AI', 'GRAPHICS'],
    significance: 'large',
    sourcePublishedAt: new Date('2026-04-24T12:00:00Z'),
    sourcePublishedAtEstimated: false,
    heroImageHash: 'abc123',
    agentLabel: 'compute-watch',
    creatorLabel: 'Web Graphics Lab',
    creatorSlug: 'web-graphics-lab',
    reasonablenessRating: 8,
    crossSource: [{ title: 'X', source_url: 'https://x/y' }],
    citations: [],
    sourceUrl: 'https://example.com/a',
    createdAt: new Date('2026-04-24T13:00:00Z'),
  }

  it('maps the canonical row to a card view', () => {
    const card = mapArticleRowToCard(baseRow)
    expect(card.id).toBe('a1')
    expect(card.slug).toBe('2026-04-24-webgpu')
    expect(card.publishedLabel).toBe('24. April 2026')
    expect(card.publishedAt).toBe('2026-04-24T12:00:00.000Z')
    expect(card.publishedEstimated).toBe(false)
    expect(card.heroImageUrl).toBe('/i/abc123')
    expect(card.agentLabel).toBe('compute-watch')
    expect(card.creatorLabel).toBe('Web Graphics Lab')
    expect(card.creatorSlug).toBe('web-graphics-lab')
    expect(card.significance).toBe('large')
    expect(card.crossSource).toEqual([{ title: 'X', source_url: 'https://x/y' }])
    expect(card.readMinutes).toBe(1)
    expect(card.createdAt).toEqual(new Date('2026-04-24T13:00:00Z'))
  })

  it('falls back to created_at when source_published_at is null', () => {
    const card = mapArticleRowToCard({ ...baseRow, sourcePublishedAt: null })
    expect(card.publishedAt).toBe('2026-04-24T13:00:00.000Z')
    expect(card.publishedLabel).toBe('24. April 2026')
  })

  it('falls back agent label to "unknown" when join missed', () => {
    const card = mapArticleRowToCard({ ...baseRow, agentLabel: null })
    expect(card.agentLabel).toBe('unknown')
  })

  it('omits creator fields entirely when target join is missing', () => {
    const card = mapArticleRowToCard({
      ...baseRow,
      creatorLabel: null,
      creatorSlug: null,
    })
    expect('creatorLabel' in card).toBe(false)
    expect('creatorSlug' in card).toBe(false)
  })

  it('hero URL is empty when hash is null', () => {
    const card = mapArticleRowToCard({ ...baseRow, heroImageHash: null })
    expect(card.heroImageUrl).toBe('')
  })

  it('coerces unknown significance values to "small" defensively', () => {
    const card = mapArticleRowToCard({ ...baseRow, significance: 'unexpected' })
    expect(card.significance).toBe('small')
  })

  it('preserves the publishedEstimated flag for the "~" UI prefix', () => {
    const card = mapArticleRowToCard({ ...baseRow, sourcePublishedAtEstimated: true })
    expect(card.publishedEstimated).toBe(true)
  })
})
