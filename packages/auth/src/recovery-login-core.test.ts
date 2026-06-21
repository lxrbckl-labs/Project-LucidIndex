import { describe, expect, it } from 'vitest'
import {
  findAdminForCode,
  type RecoveryStore,
  type RecoveryStoreCode,
  redeemRecoveryCode,
} from './recovery-login-core.js'

// Test-only verify: a stored hash is the literal string `H(<plaintext>)`.
// Keeps the core's argon2 dependency out of the unit test.
const verify = async (plaintext: string, hash: string) => hash === `H(${plaintext})`

const sampleCredential = {
  credentialId: 'cred-abc',
  publicKey: new Uint8Array([1, 2, 3]),
  signCount: 0n,
  deviceLabel: 'Recovered device',
}

function makeFakeStore(codes: RecoveryStoreCode[], opts: { consumeAlwaysFails?: boolean } = {}) {
  const consumed = new Set<string>()
  const credentialsInserted: Array<{ adminId: string; credentialId: string }> = []
  const recoveryCodesInserted: Array<{ adminId: string; codeHash: string }> = []
  const events: Array<{ adminId: string; kind: string; details: Record<string, unknown> }> = []

  const store: RecoveryStore = {
    async listUnconsumedCodes() {
      return codes.filter((c) => !consumed.has(c.id))
    },
    async consumeCode(id) {
      if (opts.consumeAlwaysFails) return false
      if (consumed.has(id)) return false
      consumed.add(id)
      return true
    },
    async insertCredential(input) {
      credentialsInserted.push({ adminId: input.adminId, credentialId: input.credentialId })
    },
    async insertRecoveryCode(input) {
      recoveryCodesInserted.push(input)
    },
    async logEvent(input) {
      events.push(input)
    },
    async withTransaction(fn) {
      return fn(store)
    },
  }

  return { store, consumed, credentialsInserted, recoveryCodesInserted, events }
}

describe('findAdminForCode', () => {
  it('returns the admin id for a matching unconsumed code', async () => {
    const { store } = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await findAdminForCode(store, verify, 'GOODCODE')

    expect(result).toEqual({ ok: true, adminId: 'admin-1', codeId: 'code-1' })
  })

  it('trims whitespace around the entered code before matching', async () => {
    const { store } = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await findAdminForCode(store, verify, '  GOODCODE  ')

    expect(result).toEqual({ ok: true, adminId: 'admin-1', codeId: 'code-1' })
  })

  it('returns not-ok when no unconsumed code matches', async () => {
    const { store } = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await findAdminForCode(store, verify, 'WRONGCODE')

    expect(result).toEqual({ ok: false })
  })

  it('returns not-ok for an empty code without scanning', async () => {
    const { store } = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await findAdminForCode(store, verify, '   ')

    expect(result).toEqual({ ok: false })
  })
})

describe('redeemRecoveryCode', () => {
  it('consumes the code, enrolls the credential, and issues a fresh code', async () => {
    const fake = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await redeemRecoveryCode(fake.store, verify, {
      code: 'GOODCODE',
      credential: sampleCredential,
      newCodeHash: 'H(NEWCODE)',
    })

    expect(result).toEqual({ ok: true, adminId: 'admin-1', credentialId: 'cred-abc' })
    // old code burned
    expect(fake.consumed.has('code-1')).toBe(true)
    // new credential enrolled for the recovered admin
    expect(fake.credentialsInserted).toEqual([{ adminId: 'admin-1', credentialId: 'cred-abc' }])
    // fresh recovery code issued
    expect(fake.recoveryCodesInserted).toEqual([{ adminId: 'admin-1', codeHash: 'H(NEWCODE)' }])
    // both audit events logged
    expect(fake.events.map((e) => e.kind)).toEqual(['recovery_used', 'passkey_register'])
  })

  it('rejects an invalid code without mutating anything', async () => {
    const fake = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }])

    const result = await redeemRecoveryCode(fake.store, verify, {
      code: 'WRONGCODE',
      credential: sampleCredential,
      newCodeHash: 'H(NEWCODE)',
    })

    expect(result).toEqual({ ok: false, reason: 'invalid_code' })
    expect(fake.credentialsInserted).toEqual([])
    expect(fake.recoveryCodesInserted).toEqual([])
    expect(fake.events).toEqual([])
  })

  it('returns raced (and enrolls nothing) when the code is consumed mid-flight', async () => {
    const fake = makeFakeStore([{ id: 'code-1', adminId: 'admin-1', codeHash: 'H(GOODCODE)' }], {
      consumeAlwaysFails: true,
    })

    const result = await redeemRecoveryCode(fake.store, verify, {
      code: 'GOODCODE',
      credential: sampleCredential,
      newCodeHash: 'H(NEWCODE)',
    })

    expect(result).toEqual({ ok: false, reason: 'raced' })
    expect(fake.credentialsInserted).toEqual([])
    expect(fake.recoveryCodesInserted).toEqual([])
    expect(fake.events).toEqual([])
  })
})
