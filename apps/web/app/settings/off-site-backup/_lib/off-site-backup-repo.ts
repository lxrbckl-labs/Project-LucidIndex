/**
 * Server-only data + validation helpers for Settings → Off-site backup.
 *
 * Schema lives in `packages/db/schema/agent.ts` (landed in #31):
 *   - `settings.off_site_backup_remote`               text
 *   - `settings.off_site_backup_credentials_encrypted` bytea
 *
 * Encryption design (v0.1):
 *   - We derive a 32-byte AES key from `IRON_SESSION_PASSWORD` using
 *     Node's built-in `hkdfSync` (RFC 5869, SHA-256).
 *   - A fixed salt ("lucidindex-off-site-backup-salt-v1") and info string
 *     ("off-site-backup-key") distinguish this key from the iron-session
 *     cookie key, even though both are derived from the same root secret.
 *   - The cipher is AES-256-GCM (authenticated encryption — guarantees
 *     both confidentiality and integrity with the 16-byte auth tag).
 *   - The bytea payload layout: [ IV (12 bytes) | tag (16 bytes) | ciphertext ]
 *
 * Trade-offs & documented decisions:
 *   1. The encryption key is deterministic from IRON_SESSION_PASSWORD. If the
 *      password is rotated, the stored credentials become un-decryptable and
 *      must be re-entered. Document this in runbook / README if Phase 7 ships.
 *   2. We do NOT derive the key on every request (that would be fine too) — we
 *      memoize it in module scope after the first call. The input is a constant
 *      env var so the result never changes within a process lifetime.
 *   3. No migration path is provided in this ticket; Phase 7 (#76) can add a
 *      key-rotation helper if needed.
 *
 * This module imports `@lucidindex/db/client`, which throws at module-load
 * time if `DATABASE_URL` is not set — i.e. it's de facto server-only.
 * Do not import it from a client component.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import { cronRuns, settings } from '@lucidindex/db/schema'

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

/** Max length for the rclone remote name (e.g. "b2-backup", "s3-prod"). */
export const REMOTE_NAME_MAX = 100
/** Max byte-length for the credentials blob pasted by the admin. */
export const CREDENTIALS_BLOB_MAX_BYTES = 8 * 1024 // 8 KB

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

const HKDF_SALT = Buffer.from('lucidindex-off-site-backup-salt-v1', 'utf8')
const HKDF_INFO = Buffer.from('off-site-backup-key', 'utf8')
const IV_LENGTH = 12 // AES-GCM: 96-bit IV is the standard recommendation
const TAG_LENGTH = 16 // AES-GCM: 128-bit auth tag
const AES_KEY_LENGTH = 32 // AES-256

let _derivedKey: Buffer | null = null

/**
 * Derive (and memoize) the AES-256 encryption key from IRON_SESSION_PASSWORD.
 * Throws if the env var is absent or too short — same guard as the session
 * module, just for a different derived secret.
 */
function getEncryptionKey(): Buffer {
  if (_derivedKey) return _derivedKey

  const password = process.env.IRON_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error(
      'IRON_SESSION_PASSWORD must be set and at least 32 characters long ' +
        '(required for off-site-backup credential encryption).',
    )
  }

  // hkdfSync(digest, ikm, salt, info, keylen) — returns a Buffer in Node ≥ 15.
  _derivedKey = Buffer.from(hkdfSync('sha256', password, HKDF_SALT, HKDF_INFO, AES_KEY_LENGTH))
  return _derivedKey
}

/**
 * Encrypt a UTF-8 plaintext credentials blob.
 * Returns a Uint8Array with layout: [ IV (12) | auth tag (16) | ciphertext ]
 */
export function encryptCredentials(plaintext: string): Uint8Array {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Layout: IV || tag || ciphertext
  return new Uint8Array(Buffer.concat([iv, tag, encrypted]))
}

/**
 * Decrypt a bytea payload produced by `encryptCredentials`.
 * Returns null if the payload is too short to be valid (defensive guard —
 * should not happen in normal operation since we control the writer).
 * Throws if the GCM auth tag verification fails (tampered or wrong key).
 */
export function decryptCredentials(payload: Uint8Array): string | null {
  const buf = Buffer.from(payload)
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    // Payload is malformed; return null rather than crashing.
    return null
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  const key = getEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

// ---------------------------------------------------------------------------
// DB read / write
// ---------------------------------------------------------------------------

export type OffSiteBackupConfig = {
  /** rclone remote name as entered by the admin, or null if not configured. */
  remoteName: string | null
  /** Decrypted credentials blob, or null if not stored. */
  credentialsBlob: string | null
}

/**
 * Read the current off-site-backup config from the settings singleton.
 * Returns nulls if the singleton row doesn't exist yet (fresh install).
 */
export async function getOffSiteBackupConfig(): Promise<OffSiteBackupConfig> {
  const rows = await db
    .select({
      offSiteBackupRemote: settings.offSiteBackupRemote,
      offSiteBackupCredentialsEncrypted: settings.offSiteBackupCredentialsEncrypted,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return { remoteName: null, credentialsBlob: null }
  }

  const credentialsBlob =
    row.offSiteBackupCredentialsEncrypted != null
      ? decryptCredentials(row.offSiteBackupCredentialsEncrypted)
      : null

  return {
    remoteName: row.offSiteBackupRemote ?? null,
    credentialsBlob,
  }
}

export type SaveOffSiteBackupInput = {
  /** rclone remote name. Empty string means "clear". */
  remoteName: string
  /** Credentials blob (rclone config block). Empty string means "clear". */
  credentialsBlob: string
}

/**
 * Upsert the off-site-backup settings using the singleton pattern
 * (INSERT ... ON CONFLICT (id) DO UPDATE with id = 1).
 *
 * Encryption is applied when `credentialsBlob` is non-empty. Storing
 * an empty string clears both fields (sets them to NULL).
 */
export async function saveOffSiteBackupConfig(input: SaveOffSiteBackupInput): Promise<void> {
  const remoteName = input.remoteName.trim() || null
  const credentialsEncrypted = input.credentialsBlob.trim()
    ? encryptCredentials(input.credentialsBlob.trim())
    : null

  await db
    .insert(settings)
    .values({
      id: 1,
      offSiteBackupRemote: remoteName,
      offSiteBackupCredentialsEncrypted: credentialsEncrypted,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        offSiteBackupRemote: remoteName,
        offSiteBackupCredentialsEncrypted: credentialsEncrypted,
        updatedAt: sql`now()`,
      },
    })
}

// ---------------------------------------------------------------------------
// Status panel helper
// ---------------------------------------------------------------------------

export type LastShipmentStatus = {
  /** null means no off_site_backup job has ever run. */
  lastRun: {
    startedAt: Date
    status: string
  } | null
}

/**
 * Return the most recent `off_site_backup` cron_run entry.
 * Used by the read-only status panel at the top of the page.
 * Phase 7 (#76) is when this will first return real data.
 */
export async function getLastShipmentStatus(): Promise<LastShipmentStatus> {
  const rows = await db
    .select({ startedAt: cronRuns.startedAt, status: cronRuns.status })
    .from(cronRuns)
    .where(eq(cronRuns.job, 'off_site_backup'))
    .orderBy(desc(cronRuns.startedAt))
    .limit(1)

  const row = rows[0]
  return { lastRun: row ? { startedAt: row.startedAt, status: row.status } : null }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type OffSiteBackupValidationErrors = Partial<{
  remoteName: string
  credentialsBlob: string
  _form: string
}>

/**
 * Validate user-supplied input. Returns an error map (empty = valid).
 *
 * Business rules:
 *   - Remote name is optional but must be ≤ 100 chars if present.
 *   - Credentials blob is optional but must be ≤ 8 KB if present.
 *   - Clearing both is legal (admin wants to remove the config).
 */
export function validateOffSiteBackupInput(
  input: SaveOffSiteBackupInput,
): OffSiteBackupValidationErrors {
  const errors: OffSiteBackupValidationErrors = {}
  const remote = input.remoteName.trim()
  const creds = input.credentialsBlob.trim()

  if (remote.length > REMOTE_NAME_MAX) {
    errors.remoteName = `Remote name must be ${REMOTE_NAME_MAX} characters or fewer.`
  }

  if (Buffer.byteLength(creds, 'utf8') > CREDENTIALS_BLOB_MAX_BYTES) {
    errors.credentialsBlob = `Credentials blob must be ${CREDENTIALS_BLOB_MAX_BYTES / 1024} KB or less.`
  }

  return errors
}
