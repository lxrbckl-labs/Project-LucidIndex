/**
 * Tests for the demo-seeder idempotency decision.
 *
 * The full `seedDemo()` function touches Postgres + the network (via
 * picsum.photos for hero images) and is exercised by the docker-compose
 * smoke flow rather than unit tests. The PURE decision — "should this
 * call be a no-op given current row counts" — is split out so we can
 * assert the contract without a DB.
 *
 * Contract (from CLAUDE.md / the LUCIDINDEX_SEED_DEMO ticket):
 *   - Skip when `targets` OR `articles` already has any row.
 *   - Otherwise run.
 *   - Reason string must mention both counts so operator logs are
 *     debuggable.
 */

import { describe, expect, it } from 'vitest'
import { decideSkip } from './seed-demo.js'

describe('decideSkip', () => {
  it('runs when both tables are empty', () => {
    const result = decideSkip(0, 0)
    expect(result.skip).toBe(false)
    expect(result.reason).toBe('')
  })

  it('skips when targets has rows', () => {
    const result = decideSkip(7, 0)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('targets=7')
    expect(result.reason).toContain('articles=0')
  })

  it('skips when articles has rows', () => {
    const result = decideSkip(0, 42)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('targets=0')
    expect(result.reason).toContain('articles=42')
  })

  it('skips when both tables have rows', () => {
    const result = decideSkip(50, 1000)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('targets=50')
    expect(result.reason).toContain('articles=1000')
  })
})
