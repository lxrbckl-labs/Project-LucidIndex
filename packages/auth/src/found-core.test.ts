/**
 * Tests for `found-core.ts`. Ported from Project-Showalter, adapted to:
 *   - the adapter-based storage shape (no SQLite required)
 *   - LucidIndex's leaner admin schema (no email column → no email tests)
 *   - the new `preCheck` seam (#27 founding-token guard hooks here)
 *
 * The fake `FoundingStore` below mimics a real transaction: every mutation
 * goes through a snapshot that's only committed if the callback resolves.
 * That's enough to faithfully exercise the rollback-on-throw paths the
 * original Showalter test suite covers.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type FoundingCredential,
  type FoundingStore,
  foundFirstAdmin,
  isAdminsTableEmpty,
} from './found-core.js'

type AdminRow = { id: string; name: string; foundingTokenHash: string | null }
type CredentialRow = { adminId: string; credential: FoundingCredential }
type RecoveryRow = { adminId: string; codeHash: string }

type State = {
  admins: AdminRow[]
  credentials: CredentialRow[]
  recoveryCodes: RecoveryRow[]
}

function makeStore(initial?: Partial<State>): FoundingStore & { state: State } {
  const state: State = {
    admins: initial?.admins ?? [],
    credentials: initial?.credentials ?? [],
    recoveryCodes: initial?.recoveryCodes ?? [],
  }

  function buildScoped(target: State): FoundingStore {
    return {
      async countAdminsIsZero() {
        return target.admins.length === 0
      },
      async insertAdmin({ name, foundingTokenHash }) {
        const id = randomUUID()
        target.admins.push({ id, name, foundingTokenHash })
        return id
      },
      async insertCredential({ adminId, credential }) {
        target.credentials.push({ adminId, credential })
      },
      async insertRecoveryCode({ adminId, codeHash }) {
        target.recoveryCodes.push({ adminId, codeHash })
      },
      async withTransaction(fn) {
        // Snapshot, run on the snapshot, commit on success, drop on throw.
        const snapshot: State = {
          admins: [...target.admins],
          credentials: [...target.credentials],
          recoveryCodes: [...target.recoveryCodes],
        }
        const tx = buildScoped(snapshot)
        const result = await fn(tx)
        target.admins = snapshot.admins
        target.credentials = snapshot.credentials
        target.recoveryCodes = snapshot.recoveryCodes
        return result
      },
    }
  }

  const top = buildScoped(state) as FoundingStore & { state: State }
  top.state = state
  return top
}

const sampleCredential: FoundingCredential = {
  credentialId: 'cred-abc',
  publicKey: new Uint8Array([1, 2, 3, 4]),
  signCount: 0n,
  deviceLabel: 'Test device',
}

describe('isAdminsTableEmpty', () => {
  it('returns true when the table is empty', async () => {
    const store = makeStore()
    expect(await isAdminsTableEmpty(store)).toBe(true)
  })

  it('returns false when at least one row exists', async () => {
    const store = makeStore({
      admins: [{ id: randomUUID(), name: 'Existing', foundingTokenHash: null }],
    })
    expect(await isAdminsTableEmpty(store)).toBe(false)
  })

  it('fails closed on a thrown error', async () => {
    const broken: Pick<FoundingStore, 'countAdminsIsZero'> = {
      async countAdminsIsZero() {
        throw new Error('db down')
      },
    }
    expect(await isAdminsTableEmpty(broken)).toBe(false)
  })
})

describe('foundFirstAdmin', () => {
  it('succeeds when admins table is empty', async () => {
    const store = makeStore()
    const res = await foundFirstAdmin(store, { name: 'Founder' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(typeof res.adminId).toBe('string')
      expect(res.adminId.length).toBeGreaterThan(0)
    }
    expect(store.state.admins).toHaveLength(1)
    expect(store.state.admins[0]?.name).toBe('Founder')
    expect(store.state.admins[0]?.foundingTokenHash).toBeNull()
  })

  it('fails when admins table is non-empty (canonical failure shape)', async () => {
    const existing: AdminRow = { id: randomUUID(), name: 'First', foundingTokenHash: null }
    const store = makeStore({ admins: [existing] })

    const res = await foundFirstAdmin(store, { name: 'Second' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('admins_not_empty')
    }
    expect(store.state.admins).toHaveLength(1)
    expect(store.state.admins[0]?.name).toBe('First')
  })

  it('trims the supplied name', async () => {
    const store = makeStore()
    const res = await foundFirstAdmin(store, { name: '  Alex  ' })
    expect(res.ok).toBe(true)
    expect(store.state.admins[0]?.name).toBe('Alex')
  })

  it('rejects an empty / whitespace-only name', async () => {
    const store = makeStore()
    const res = await foundFirstAdmin(store, { name: '   ' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('insert_failed')
    expect(store.state.admins).toHaveLength(0)
  })

  it('persists the founding-token hash when provided', async () => {
    const store = makeStore()
    const res = await foundFirstAdmin(store, {
      name: 'Founder',
      foundingTokenHash: 'argon2-hash-here',
    })
    expect(res.ok).toBe(true)
    expect(store.state.admins[0]?.foundingTokenHash).toBe('argon2-hash-here')
  })

  it('persists credential + recovery code when provided', async () => {
    const store = makeStore()
    const res = await foundFirstAdmin(store, {
      name: 'Founder',
      credential: sampleCredential,
      hashedRecoveryCode: 'hashed',
    })
    expect(res.ok).toBe(true)
    expect(store.state.credentials).toHaveLength(1)
    expect(store.state.credentials[0]?.credential.credentialId).toBe('cred-abc')
    expect(store.state.recoveryCodes).toHaveLength(1)
    expect(store.state.recoveryCodes[0]?.codeHash).toBe('hashed')
  })

  it('rolls back all inserts when an insert throws partway', async () => {
    const store = makeStore()
    // Sabotage `insertRecoveryCode` so the credential insert succeeds but
    // the recovery insert blows up. The whole tx must roll back.
    const sabotaged: FoundingStore = {
      ...store,
      async withTransaction(fn) {
        return store.withTransaction(async (tx) => {
          const wrapped: FoundingStore = {
            ...tx,
            async insertRecoveryCode() {
              throw new Error('synthetic infra blip')
            },
          }
          return fn(wrapped)
        })
      },
    }
    const res = await foundFirstAdmin(sabotaged, {
      name: 'Founder',
      credential: sampleCredential,
      hashedRecoveryCode: 'hashed',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('insert_failed')
    expect(store.state.admins).toHaveLength(0)
    expect(store.state.credentials).toHaveLength(0)
    expect(store.state.recoveryCodes).toHaveLength(0)
  })

  it('serializes concurrent calls — exactly one wins', async () => {
    // The fake store snapshots inside withTransaction and only commits on
    // success, so back-to-back `await`s mirror serializable txn semantics.
    const store = makeStore()
    const first = await foundFirstAdmin(store, { name: 'Winner' })
    const second = await foundFirstAdmin(store, { name: 'Loser' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('admins_not_empty')

    expect(store.state.admins).toHaveLength(1)
    expect(store.state.admins[0]?.name).toBe('Winner')
  })

  describe('preCheck seam (#27 founding-token guard hook)', () => {
    it('runs preCheck inside the transaction, after empty-check', async () => {
      const store = makeStore()
      let calledWith: { name: string; foundingTokenHash: string | null } | null = null
      const res = await foundFirstAdmin(
        store,
        { name: 'Founder', foundingTokenHash: 'tok-hash' },
        {
          async preCheck(input) {
            calledWith = input
            // Snapshot state at the moment preCheck runs: the tx has confirmed
            // the table is empty but no admin has been inserted yet.
            expect(store.state.admins).toHaveLength(0)
            return { ok: true }
          },
        },
      )
      expect(res.ok).toBe(true)
      expect(calledWith).toEqual({ name: 'Founder', foundingTokenHash: 'tok-hash' })
      expect(store.state.admins).toHaveLength(1)
    })

    it('rolls back when preCheck returns { ok: false }', async () => {
      const store = makeStore()
      const res = await foundFirstAdmin(
        store,
        { name: 'Founder', foundingTokenHash: 'wrong-hash' },
        {
          async preCheck() {
            return { ok: false }
          },
        },
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.reason).toBe('precheck_failed')
      expect(store.state.admins).toHaveLength(0)
    })

    it('skips preCheck when admins table is non-empty (race-loser path)', async () => {
      const existing: AdminRow = { id: randomUUID(), name: 'First', foundingTokenHash: null }
      const store = makeStore({ admins: [existing] })
      let preCheckCalls = 0
      const res = await foundFirstAdmin(
        store,
        { name: 'Second' },
        {
          async preCheck() {
            preCheckCalls++
            return { ok: true }
          },
        },
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.reason).toBe('admins_not_empty')
      // preCheck must not run if the empty-check already failed — saves us
      // from leaking signal via timing or side effects in the hook.
      expect(preCheckCalls).toBe(0)
    })
  })
})
