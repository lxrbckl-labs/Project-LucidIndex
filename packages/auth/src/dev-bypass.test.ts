/**
 * Unit tests for `dev-bypass.ts`.
 *
 * Tests cover: disabled by default, enabled via various truthy strings,
 * refused in production, case-insensitive parsing.
 *
 * Because `isDevAuthBypassActive` guards its console output behind module-
 * scope flags, each test that expects a log fires in its own `vi.isolateModules`
 * block so the flag is reset. Tests that don't care about log output reuse a
 * shared import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-import `dev-bypass` after patching `process.env` so module-scope state
 * (`warnedActive`, `erroredProd`) is reset. Returns the fresh module.
 */
async function importFresh() {
  // Clear the module registry so `dev-bypass.ts` re-executes from scratch.
  vi.resetModules()
  return import('./dev-bypass.js')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isDevAuthBypassActive', () => {
  // Snapshot env vars we might mutate and restore them after each test.
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalEnv.LUCIDINDEX_DEV_SKIP_AUTH = process.env.LUCIDINDEX_DEV_SKIP_AUTH
    originalEnv.NODE_ENV = process.env.NODE_ENV
  })

  afterEach(() => {
    if (originalEnv.LUCIDINDEX_DEV_SKIP_AUTH === undefined) {
      delete process.env.LUCIDINDEX_DEV_SKIP_AUTH
    } else {
      process.env.LUCIDINDEX_DEV_SKIP_AUTH = originalEnv.LUCIDINDEX_DEV_SKIP_AUTH
    }
    // NODE_ENV is read-only in some runtimes; best-effort restore.
    try {
      if (originalEnv.NODE_ENV === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalEnv.NODE_ENV
      }
    } catch {
      // ignore
    }
  })

  it('returns false when LUCIDINDEX_DEV_SKIP_AUTH is unset', async () => {
    delete process.env.LUCIDINDEX_DEV_SKIP_AUTH
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(false)
  })

  it('returns false when LUCIDINDEX_DEV_SKIP_AUTH is empty string', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = ''
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(false)
  })

  it('returns false for an unrecognised value', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'nope'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(false)
  })

  it('returns true for "true" (lowercase)', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'true'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  it('returns true for "1"', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = '1'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  it('returns true for "yes"', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'yes'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  it('is case-insensitive — "TRUE" is accepted', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'TRUE'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  it('is case-insensitive — "Yes" is accepted', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'Yes'
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  it('trims surrounding whitespace before comparing', async () => {
    process.env.LUCIDINDEX_DEV_SKIP_AUTH = '  true  '
    process.env.NODE_ENV = 'test'
    const { isDevAuthBypassActive } = await importFresh()
    expect(isDevAuthBypassActive()).toBe(true)
  })

  describe('production guard', () => {
    it('returns false and emits console.error when NODE_ENV=production', async () => {
      process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'true'
      process.env.NODE_ENV = 'production'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { isDevAuthBypassActive } = await importFresh()
      expect(isDevAuthBypassActive()).toBe(false)
      expect(errorSpy).toHaveBeenCalledWith(
        '[auth] LUCIDINDEX_DEV_SKIP_AUTH ignored: refusing to bypass auth in production',
      )
      errorSpy.mockRestore()
    })

    it('emits the production error at most once per process (module-scope guard)', async () => {
      process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'true'
      process.env.NODE_ENV = 'production'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { isDevAuthBypassActive } = await importFresh()
      isDevAuthBypassActive()
      isDevAuthBypassActive()
      isDevAuthBypassActive()
      expect(errorSpy).toHaveBeenCalledTimes(1)
      errorSpy.mockRestore()
    })
  })

  describe('active-state warning', () => {
    it('emits console.warn when bypass is first activated', async () => {
      process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'true'
      process.env.NODE_ENV = 'test'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { isDevAuthBypassActive } = await importFresh()
      isDevAuthBypassActive()
      expect(warnSpy).toHaveBeenCalledWith(
        '[auth] LUCIDINDEX_DEV_SKIP_AUTH is active — auth checks are bypassed. Do NOT use this flag in production.',
      )
      warnSpy.mockRestore()
    })

    it('emits the warning at most once per process (module-scope guard)', async () => {
      process.env.LUCIDINDEX_DEV_SKIP_AUTH = 'true'
      process.env.NODE_ENV = 'test'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { isDevAuthBypassActive } = await importFresh()
      isDevAuthBypassActive()
      isDevAuthBypassActive()
      isDevAuthBypassActive()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })
})

describe('devForumBypassUsername', () => {
  // Snapshot env vars we might mutate and restore them after each test.
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalEnv.LUCIDINDEX_DEV_FORUM_USER = process.env.LUCIDINDEX_DEV_FORUM_USER
    originalEnv.NODE_ENV = process.env.NODE_ENV
  })

  afterEach(() => {
    if (originalEnv.LUCIDINDEX_DEV_FORUM_USER === undefined) {
      delete process.env.LUCIDINDEX_DEV_FORUM_USER
    } else {
      process.env.LUCIDINDEX_DEV_FORUM_USER = originalEnv.LUCIDINDEX_DEV_FORUM_USER
    }
    // NODE_ENV is read-only in some runtimes; best-effort restore.
    try {
      if (originalEnv.NODE_ENV === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalEnv.NODE_ENV
      }
    } catch {
      // ignore
    }
  })

  it('returns null when LUCIDINDEX_DEV_FORUM_USER is unset', async () => {
    delete process.env.LUCIDINDEX_DEV_FORUM_USER
    process.env.NODE_ENV = 'test'
    const { devForumBypassUsername } = await importFresh()
    expect(devForumBypassUsername()).toBeNull()
  })

  it('returns null when LUCIDINDEX_DEV_FORUM_USER is empty string', async () => {
    process.env.LUCIDINDEX_DEV_FORUM_USER = ''
    process.env.NODE_ENV = 'test'
    const { devForumBypassUsername } = await importFresh()
    expect(devForumBypassUsername()).toBeNull()
  })

  it('returns null when LUCIDINDEX_DEV_FORUM_USER is whitespace-only', async () => {
    process.env.LUCIDINDEX_DEV_FORUM_USER = '   '
    process.env.NODE_ENV = 'test'
    const { devForumBypassUsername } = await importFresh()
    expect(devForumBypassUsername()).toBeNull()
  })

  it('returns the trimmed username in non-production', async () => {
    process.env.LUCIDINDEX_DEV_FORUM_USER = '  alice  '
    process.env.NODE_ENV = 'test'
    const { devForumBypassUsername } = await importFresh()
    expect(devForumBypassUsername()).toBe('alice')
  })

  it('warns on first activation in non-production', async () => {
    process.env.LUCIDINDEX_DEV_FORUM_USER = 'alice'
    process.env.NODE_ENV = 'test'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { devForumBypassUsername } = await importFresh()
    devForumBypassUsername()
    expect(warnSpy).toHaveBeenCalledWith(
      '[auth] LUCIDINDEX_DEV_FORUM_USER is active — forum auth bypassed as "alice". Do NOT use this flag in production.',
    )
    warnSpy.mockRestore()
  })

  it('emits the activation warning at most once per process', async () => {
    process.env.LUCIDINDEX_DEV_FORUM_USER = 'alice'
    process.env.NODE_ENV = 'test'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { devForumBypassUsername } = await importFresh()
    devForumBypassUsername()
    devForumBypassUsername()
    devForumBypassUsername()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  describe('production guard', () => {
    it('returns null and emits console.error when NODE_ENV=production', async () => {
      process.env.LUCIDINDEX_DEV_FORUM_USER = 'alice'
      process.env.NODE_ENV = 'production'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { devForumBypassUsername } = await importFresh()
      expect(devForumBypassUsername()).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        '[auth] LUCIDINDEX_DEV_FORUM_USER ignored: refusing to bypass forum auth in production',
      )
      errorSpy.mockRestore()
    })

    it('emits the production error at most once per process (module-scope guard)', async () => {
      process.env.LUCIDINDEX_DEV_FORUM_USER = 'alice'
      process.env.NODE_ENV = 'production'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { devForumBypassUsername } = await importFresh()
      devForumBypassUsername()
      devForumBypassUsername()
      devForumBypassUsername()
      expect(errorSpy).toHaveBeenCalledTimes(1)
      errorSpy.mockRestore()
    })
  })
})

describe('DEV_BYPASS_ADMIN_ID', () => {
  it('exports a valid all-zeroes UUID sentinel', async () => {
    const { DEV_BYPASS_ADMIN_ID } = await importFresh()
    expect(typeof DEV_BYPASS_ADMIN_ID).toBe('string')
    expect(DEV_BYPASS_ADMIN_ID.length).toBeGreaterThan(0)
    // Sentinel must be a valid UUID so it passes Postgres UUID-typed columns.
    expect(DEV_BYPASS_ADMIN_ID).toBe('00000000-0000-0000-0000-000000000000')
  })
})
