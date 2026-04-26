/**
 * Pure first-admin enrollment logic.
 *
 * Ported from Project-Showalter (`src/features/auth/found-core.ts`), with
 * three adaptations:
 *
 *   1. **Storage abstraction.** Showalter calls `db.transaction(...)`
 *      directly against a synchronous `better-sqlite3` connection. LucidIndex
 *      is on Postgres via `drizzle-orm/postgres-js`, where transactions are
 *      async and there's no synchronous `prepare().get()` style API. Rather
 *      than embed the postgres-js wiring here (and force tests to stand up
 *      Postgres), this module accepts a small `FoundingStore` adapter that
 *      describes the four operations the enrollment needs: count, insert
 *      admin, insert credential, insert recovery code — all wrapped in an
 *      atomic `withTransaction(...)`. The wrapper in `found.ts` provides a
 *      Drizzle-backed implementation; tests wire in an in-memory fake.
 *
 *   2. **uuid admin ids.** `admins.id` is a uuid in LucidIndex (vs. integer
 *      autoincrement in Showalter). `adminId` is `string` everywhere.
 *
 *   3. **Founding-token seam (#27).** Ticket #27 wraps this flow with an
 *      env-var guard — `LUCIDINDEX_FOUNDING_TOKEN` must match a hash on the
 *      to-be-inserted admin row before the first-admin write succeeds. To
 *      let #27 wire that check in cleanly, this module accepts an optional
 *      `preCheck` async hook that runs INSIDE the transaction, after the
 *      empty-table check but BEFORE any insert. Returning `{ ok: false }`
 *      from `preCheck` causes the transaction to roll back with reason
 *      `'precheck_failed'`. This module does NOT implement the env-var
 *      check itself — that's #27's job.
 */

export type FoundingCredential = {
  /** base64url-encoded WebAuthn credential id */
  credentialId: string
  /** raw COSE public key bytes */
  publicKey: Uint8Array
  /** signature counter at registration time */
  signCount: bigint
  /** Admin-supplied label ("MacBook TouchID", etc.) */
  deviceLabel: string
}

export type FoundFirstAdminInput = {
  /** Display name for the new admin (e.g. "Alex"). Trimmed by callers. */
  name: string
  /**
   * If provided, the credential is recorded as the founding device. Always
   * present in the WebAuthn-driven path; left optional so tests can exercise
   * the bare admin insert.
   */
  credential?: FoundingCredential
  /**
   * If provided, the pre-hashed recovery code is persisted. As above —
   * always present in the live path, optional for tests.
   */
  hashedRecoveryCode?: string
  /**
   * Hash of the founding token used to authorize this enrollment. Set on
   * the admin row at creation time; #27 nulls it out once recovery codes
   * are minted. Optional here so this module stays usable in tests and so
   * a future "founding without token" mode (e.g. CLI-driven) can omit it.
   */
  foundingTokenHash?: string
}

export type FoundFirstAdminFailure =
  /** The `admins` table was non-empty when the transaction started. */
  | 'admins_not_empty'
  /** The `preCheck` hook returned `{ ok: false }` (e.g. #27 token mismatch). */
  | 'precheck_failed'
  /** Any insert threw — UNIQUE conflict, network blip, etc. */
  | 'insert_failed'

export type FoundFirstAdminResult =
  | { ok: true; adminId: string }
  | { ok: false; reason: FoundFirstAdminFailure }

/**
 * Storage adapter. Each method is called from inside `withTransaction`.
 *
 * `withTransaction` MUST run its callback in a single atomic transaction
 * and roll back on any thrown error. The Drizzle implementation in
 * `found.ts` uses `db.transaction(...)`; the test fake uses a snapshot
 * + commit-or-rollback pattern.
 */
export type FoundingStore = {
  /** Returns true iff the `admins` table currently has zero rows. */
  countAdminsIsZero(): Promise<boolean>

  /**
   * Insert a new admin row and return its uuid. Caller has already verified
   * the table is empty inside the same transaction — the implementation
   * should NOT re-check.
   */
  insertAdmin(input: { name: string; foundingTokenHash: string | null }): Promise<string>

  /** Insert a credential row tied to `adminId`. */
  insertCredential(input: { adminId: string; credential: FoundingCredential }): Promise<void>

  /** Insert a hashed recovery-code row tied to `adminId`. */
  insertRecoveryCode(input: { adminId: string; codeHash: string }): Promise<void>

  /**
   * Run `fn` inside a transaction. The callback receives a `FoundingStore`
   * scoped to the transaction — Drizzle's `tx` value. If `fn` throws, the
   * transaction MUST roll back.
   */
  withTransaction<T>(fn: (tx: FoundingStore) => Promise<T>): Promise<T>
}

/** Hook signature for #27's founding-token guard. */
export type FoundingPreCheck = (input: {
  /** Mirrors the input that's about to be persisted. */
  name: string
  foundingTokenHash: string | null
}) => Promise<{ ok: true } | { ok: false }>

/**
 * Cheap read-only check — "zero rows in admins?". Does NOT open a
 * transaction; the authoritative check is the one inside `foundFirstAdmin`'s
 * transaction. Use this for "should we render the founding form?" UX gates.
 *
 * Fails closed: any thrown error returns false, so a broken DB never
 * accidentally exposes the founding flow.
 */
export async function isAdminsTableEmpty(
  store: Pick<FoundingStore, 'countAdminsIsZero'>,
): Promise<boolean> {
  try {
    return await store.countAdminsIsZero()
  } catch {
    return false
  }
}

/**
 * Atomically (inside one transaction):
 *   - re-check that `admins` is empty
 *   - run `preCheck` (if provided) — #27 hooks in here
 *   - INSERT the new admin row (with optional `foundingTokenHash`)
 *   - optionally INSERT the founding credential + hashed recovery code
 *
 * Failure modes:
 *   - `'admins_not_empty'` — race loser, table was non-empty.
 *   - `'precheck_failed'` — `preCheck` rejected (#27 token mismatch).
 *   - `'insert_failed'` — any insert threw (UNIQUE conflict, infra blip).
 *
 * The caller is responsible for: generating + hashing the recovery code,
 * verifying the WebAuthn ceremony, logging, rate limiting, and post-
 * success session minting.
 */
export async function foundFirstAdmin(
  store: FoundingStore,
  input: FoundFirstAdminInput,
  options?: { preCheck?: FoundingPreCheck },
): Promise<FoundFirstAdminResult> {
  const trimmedName = input.name.trim()
  if (trimmedName.length === 0) {
    return { ok: false, reason: 'insert_failed' }
  }
  const foundingTokenHash = input.foundingTokenHash ?? null

  try {
    return await store.withTransaction(async (tx) => {
      const empty = await tx.countAdminsIsZero()
      if (!empty) {
        // Throw a sentinel so the transaction rolls back; we map it back to
        // a typed failure below.
        const err = new Error('admins_not_empty_tx') as Error & { reason: FoundFirstAdminFailure }
        err.reason = 'admins_not_empty'
        throw err
      }

      if (options?.preCheck) {
        const checked = await options.preCheck({ name: trimmedName, foundingTokenHash })
        if (!checked.ok) {
          const err = new Error('precheck_failed_tx') as Error & {
            reason: FoundFirstAdminFailure
          }
          err.reason = 'precheck_failed'
          throw err
        }
      }

      const adminId = await tx.insertAdmin({
        name: trimmedName,
        foundingTokenHash,
      })

      if (input.credential) {
        await tx.insertCredential({ adminId, credential: input.credential })
      }
      if (input.hashedRecoveryCode) {
        await tx.insertRecoveryCode({ adminId, codeHash: input.hashedRecoveryCode })
      }

      return { ok: true as const, adminId }
    })
  } catch (err) {
    const reason =
      err && typeof err === 'object' && 'reason' in err
        ? ((err as { reason: FoundFirstAdminFailure }).reason ?? 'insert_failed')
        : 'insert_failed'
    return { ok: false, reason }
  }
}
