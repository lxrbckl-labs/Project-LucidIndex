/**
 * Tests for the source-URL normalizer (P0 / audit round 3).
 *
 * Coverage maps 1:1 to the rules in `url.ts`:
 *
 *   1. host lowercased
 *   2. default ports stripped (`:80` for http, `:443` for https)
 *   3. fragment stripped
 *   4. leading `www.` stripped from host
 *   5. tracking params dropped (`utm_*`, `fbclid`, `gclid`, `ref`,
 *      `ref_src`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`)
 *   6. remaining query params sorted alphabetically
 *   7. trailing slash stripped from path (unless path is `/`)
 *   8. parse failures raise `InvalidSourceUrlError`
 *
 * Plus the collision contract — each pair of "different" URLs that the
 * normalizer is supposed to collapse renders to the same string.
 */

import { describe, expect, it } from 'vitest'
import { InvalidSourceUrlError, normalizeSourceUrl } from './url.js'

describe('normalizeSourceUrl', () => {
  // ---------------------------------------------------------------------
  // 1. host lowercased
  // ---------------------------------------------------------------------
  it('lowercases the host', () => {
    expect(normalizeSourceUrl('https://Example.COM/a')).toBe('https://example.com/a')
  })

  // ---------------------------------------------------------------------
  // 2. default ports stripped
  // ---------------------------------------------------------------------
  it('strips :80 from http URLs', () => {
    expect(normalizeSourceUrl('http://example.com:80/a')).toBe('http://example.com/a')
  })

  it('strips :443 from https URLs', () => {
    expect(normalizeSourceUrl('https://example.com:443/a')).toBe('https://example.com/a')
  })

  it('preserves non-default ports', () => {
    expect(normalizeSourceUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a')
  })

  // ---------------------------------------------------------------------
  // 3. fragment stripped
  // ---------------------------------------------------------------------
  it('strips the fragment', () => {
    expect(normalizeSourceUrl('https://example.com/a#section-2')).toBe('https://example.com/a')
  })

  it('strips an empty fragment (lone #)', () => {
    expect(normalizeSourceUrl('https://example.com/a#')).toBe('https://example.com/a')
  })

  // ---------------------------------------------------------------------
  // 4. leading www. stripped
  // ---------------------------------------------------------------------
  it('strips leading www. from the host', () => {
    expect(normalizeSourceUrl('https://www.example.com/a')).toBe('https://example.com/a')
  })

  it('does not strip inner www. labels', () => {
    expect(normalizeSourceUrl('https://www.foo.www.bar.com/a')).toBe('https://foo.www.bar.com/a')
  })

  // ---------------------------------------------------------------------
  // 5. tracking params dropped
  // ---------------------------------------------------------------------
  it('drops utm_* tracking params', () => {
    expect(normalizeSourceUrl('https://example.com/a?utm_source=newsletter&utm_medium=email')).toBe(
      'https://example.com/a',
    )
  })

  it('drops named tracking params (fbclid, gclid, etc.)', () => {
    expect(
      normalizeSourceUrl(
        'https://example.com/a?fbclid=abc&gclid=def&ref=twitter&ref_src=tw&mc_cid=1&mc_eid=2&_hsenc=x&_hsmi=y',
      ),
    ).toBe('https://example.com/a')
  })

  it('preserves non-tracking query params', () => {
    expect(normalizeSourceUrl('https://example.com/a?id=123&utm_source=x')).toBe(
      'https://example.com/a?id=123',
    )
  })

  // ---------------------------------------------------------------------
  // 6. remaining query params sorted alphabetically
  // ---------------------------------------------------------------------
  it('sorts surviving query params alphabetically', () => {
    expect(normalizeSourceUrl('https://example.com/a?b=2&a=1')).toBe(
      'https://example.com/a?a=1&b=2',
    )
  })

  it('produces identical output for differently-ordered query params', () => {
    expect(normalizeSourceUrl('https://example.com/a?b=2&a=1')).toBe(
      normalizeSourceUrl('https://example.com/a?a=1&b=2'),
    )
  })

  // ---------------------------------------------------------------------
  // 7. trailing slash stripped (unless path is /)
  // ---------------------------------------------------------------------
  it('strips trailing slash from non-root paths', () => {
    expect(normalizeSourceUrl('https://example.com/a/')).toBe('https://example.com/a')
  })

  it('preserves the root path slash', () => {
    expect(normalizeSourceUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves the implicit root path when no slash was given', () => {
    // WHATWG URL normalizes 'https://example.com' to 'https://example.com/'
    // (it always adds the root path). Our normalizer keeps that root slash.
    expect(normalizeSourceUrl('https://example.com')).toBe('https://example.com/')
  })

  // ---------------------------------------------------------------------
  // 8. parse failures
  // ---------------------------------------------------------------------
  it('throws InvalidSourceUrlError on parse failure', () => {
    expect(() => normalizeSourceUrl('not a url')).toThrow(InvalidSourceUrlError)
  })

  it('throws InvalidSourceUrlError on an empty string', () => {
    expect(() => normalizeSourceUrl('')).toThrow(InvalidSourceUrlError)
  })

  it('sets a code of invalid_source_url on the thrown error', () => {
    try {
      normalizeSourceUrl('not a url')
      throw new Error('expected normalizeSourceUrl to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSourceUrlError)
      expect((err as InvalidSourceUrlError).code).toBe('invalid_source_url')
    }
  })

  // ---------------------------------------------------------------------
  // Collision contract — the example case from the original P0 bug report
  // ---------------------------------------------------------------------
  it('collapses the canonical bug-report triple to a single key', () => {
    const a = normalizeSourceUrl('https://Example.com/a/')
    const b = normalizeSourceUrl('https://example.com/a')
    const c = normalizeSourceUrl('https://example.com/a?utm_source=newsletter')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('collapses www. + tracking + case variations to one key', () => {
    const variants = [
      'https://www.Example.com/article?utm_source=x',
      'https://example.com/article',
      'https://EXAMPLE.com/article#discussion',
      'https://www.example.com:443/article/',
    ]
    const normalized = variants.map(normalizeSourceUrl)
    for (const n of normalized) {
      expect(n).toBe(normalized[0])
    }
  })
})
