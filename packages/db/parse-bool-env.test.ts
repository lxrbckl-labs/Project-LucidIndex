/**
 * Tests for the boolean env-var parser used by LUCIDINDEX_SEED_DEMO.
 *
 * The contract: `true`, `1`, `yes` (case-insensitive, trimmed) are the
 * ONLY truthy values. Everything else is falsy. We deliberately do not
 * accept `on`, `enabled`, `y`, etc. — narrow truthy semantics keep
 * operator intent in `.env` / docker-compose files explicit.
 */

import { describe, expect, it } from 'vitest'
import { parseBoolEnv } from './parse-bool-env.js'

describe('parseBoolEnv', () => {
  it('treats `true` (any case) as truthy', () => {
    expect(parseBoolEnv('true')).toBe(true)
    expect(parseBoolEnv('True')).toBe(true)
    expect(parseBoolEnv('TRUE')).toBe(true)
    expect(parseBoolEnv('  true  ')).toBe(true)
  })

  it('treats `1` as truthy', () => {
    expect(parseBoolEnv('1')).toBe(true)
    expect(parseBoolEnv(' 1 ')).toBe(true)
  })

  it('treats `yes` (any case) as truthy', () => {
    expect(parseBoolEnv('yes')).toBe(true)
    expect(parseBoolEnv('Yes')).toBe(true)
    expect(parseBoolEnv('YES')).toBe(true)
  })

  it('treats `false` as falsy', () => {
    expect(parseBoolEnv('false')).toBe(false)
    expect(parseBoolEnv('False')).toBe(false)
    expect(parseBoolEnv('FALSE')).toBe(false)
  })

  it('treats `0` as falsy', () => {
    expect(parseBoolEnv('0')).toBe(false)
  })

  it('treats undefined / null / empty string as falsy', () => {
    expect(parseBoolEnv(undefined)).toBe(false)
    expect(parseBoolEnv(null)).toBe(false)
    expect(parseBoolEnv('')).toBe(false)
    expect(parseBoolEnv('   ')).toBe(false)
  })

  it('treats unknown / weird values as falsy', () => {
    expect(parseBoolEnv('on')).toBe(false)
    expect(parseBoolEnv('enabled')).toBe(false)
    expect(parseBoolEnv('y')).toBe(false)
    expect(parseBoolEnv('2')).toBe(false)
    expect(parseBoolEnv('truthy')).toBe(false)
    expect(parseBoolEnv('no')).toBe(false)
    expect(parseBoolEnv('garbage')).toBe(false)
  })
})
