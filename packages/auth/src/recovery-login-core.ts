/**
 * Recovery-code login flow — pure orchestration core.
 *
 * Mirrors the seam pattern of `found-core.ts`: all Postgres/Drizzle access is
 * hidden behind the `RecoveryStore` interface and the argon2 verify is an
 * injected function, so this orchestration is unit-testable without a DB or a
 * real KDF. The Drizzle-backed store + argon2 wiring live in
 * `recovery-login.ts`.
 *
 * The flow this core powers: an admin who has lost their passkey(s) proves
 * possession of their one-time recovery code, which earns them the right to
 * enroll a NEW passkey. The old code is burned and a fresh one issued — a
 * recovery is a code rotation, not a reusable password.
 */

/** One unconsumed recovery-code row, narrowed to what matching needs. */
export type RecoveryStoreCode = { id: string; adminId: string; codeHash: string }

export interface RecoveryStore {
  /** Every recovery code that has not yet been consumed. */
  listUnconsumedCodes(): Promise<RecoveryStoreCode[]>
  /**
   * Atomically consume the code identified by `id`, but ONLY if it is still
   * unconsumed. Returns `true` if this call won the race and consumed it,
   * `false` if it was already consumed (lost the race). This conditional
   * semantics is what makes concurrent redemption TOCTOU-safe.
   */
  consumeCode(id: string): Promise<boolean>
  insertCredential(input: {
    adminId: string
    credentialId: string
    publicKey: Uint8Array
    signCount: bigint
    deviceLabel: string
  }): Promise<void>
  insertRecoveryCode(input: { adminId: string; codeHash: string }): Promise<void>
  logEvent(input: {
    adminId: string
    kind: string
    details: Record<string, unknown>
  }): Promise<void>
  withTransaction<T>(fn: (tx: RecoveryStore) => Promise<T>): Promise<T>
}

/** Injected argon2 verify: does `plaintext` hash to `hash`? */
export type VerifyCodeFn = (plaintext: string, hash: string) => Promise<boolean>

export type FindAdminForCodeResult = { ok: true; adminId: string; codeId: string } | { ok: false }

/**
 * Scan unconsumed recovery codes and return the admin + code-row id whose
 * hash matches the entered code. A linear argon2 scan is fine here: a
 * single-admin LucidIndex has at most one unconsumed code at a time, and the
 * scan is bounded by how many codes were ever regenerated-but-not-burned.
 */
export async function findAdminForCode(
  store: RecoveryStore,
  verify: VerifyCodeFn,
  code: string,
): Promise<FindAdminForCodeResult> {
  const candidate = code.trim()
  if (candidate.length === 0) return { ok: false }

  const rows = await store.listUnconsumedCodes()
  for (const row of rows) {
    if (await verify(candidate, row.codeHash)) {
      return { ok: true, adminId: row.adminId, codeId: row.id }
    }
  }
  return { ok: false }
}

export type RedeemRecoveryInput = {
  code: string
  credential: {
    credentialId: string
    publicKey: Uint8Array
    signCount: bigint
    deviceLabel: string
  }
  newCodeHash: string
}

export type RedeemRecoveryResult =
  | { ok: true; adminId: string; credentialId: string }
  | { ok: false; reason: 'invalid_code' | 'raced' }

/**
 * Burn the matching recovery code and enroll the (already WebAuthn-verified)
 * credential, issuing a fresh recovery code — all in one transaction.
 *
 * The matching argon2 scan runs OUTSIDE the transaction (it's CPU-bound and
 * shouldn't hold a row lock), but consumption is a conditional update inside
 * the transaction, so a code consumed between the scan and the commit yields
 * `raced` and enrolls nothing.
 */
export async function redeemRecoveryCode(
  store: RecoveryStore,
  verify: VerifyCodeFn,
  input: RedeemRecoveryInput,
): Promise<RedeemRecoveryResult> {
  const match = await findAdminForCode(store, verify, input.code)
  if (!match.ok) return { ok: false, reason: 'invalid_code' }

  return store.withTransaction(async (tx) => {
    const consumed = await tx.consumeCode(match.codeId)
    if (!consumed) return { ok: false, reason: 'raced' }

    await tx.insertCredential({
      adminId: match.adminId,
      credentialId: input.credential.credentialId,
      publicKey: input.credential.publicKey,
      signCount: input.credential.signCount,
      deviceLabel: input.credential.deviceLabel,
    })
    await tx.insertRecoveryCode({ adminId: match.adminId, codeHash: input.newCodeHash })
    await tx.logEvent({
      adminId: match.adminId,
      kind: 'recovery_used',
      details: { credentialId: input.credential.credentialId },
    })
    await tx.logEvent({
      adminId: match.adminId,
      kind: 'passkey_register',
      details: {
        credentialId: input.credential.credentialId,
        deviceLabel: input.credential.deviceLabel,
        via: 'recovery',
      },
    })

    return { ok: true, adminId: match.adminId, credentialId: input.credential.credentialId }
  })
}
