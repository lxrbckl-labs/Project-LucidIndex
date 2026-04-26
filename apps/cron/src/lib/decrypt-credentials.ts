// Off-site backup credential decryption (#76).
//
// MUST stay byte-for-byte compatible with apps/web's encrypt path
// (apps/web/app/settings/off-site-backup/_lib/off-site-backup-repo.ts ::
// encryptCredentials). The cron sidecar reads the encrypted bytea from
// settings.off_site_backup_credentials_encrypted and decrypts it locally
// to feed rclone's --config flag — apps/web is offline-decoupled here.
//
// Algorithm summary:
//   - Key derivation : HKDF-SHA256(IRON_SESSION_PASSWORD, salt, info, 32)
//   - Cipher         : AES-256-GCM (authenticated)
//   - Payload layout : [ IV (12 bytes) | tag (16 bytes) | ciphertext ]
//
// HKDF salt + info constants are intentionally identical to apps/web. If
// they ever diverge here, decryption will silently fail with a tag-mismatch
// throw — the apps/web file holds the canonical values and any change to
// either side requires updating both.
//
// The derived key is memoized in module scope; the password is a constant
// env var so the result never changes within a process lifetime.
//
// HARD RULE: never log the password, the derived key, the ciphertext, or
// the plaintext. The job-level catch logs only the failure shape (string
// reason / "decrypt failed" — not what was being decrypted).

import { createDecipheriv, hkdfSync } from 'node:crypto'

const HKDF_SALT = Buffer.from('lucidindex-off-site-backup-salt-v1', 'utf8')
const HKDF_INFO = Buffer.from('off-site-backup-key', 'utf8')
const IV_LENGTH = 12
const TAG_LENGTH = 16
const AES_KEY_LENGTH = 32

let _derivedKey: Buffer | null = null

function getEncryptionKey(password: string): Buffer {
  if (_derivedKey) return _derivedKey
  if (password.length < 32) {
    throw new Error(
      'IRON_SESSION_PASSWORD must be at least 32 characters long for ' +
        'off-site-backup credential decryption.',
    )
  }
  _derivedKey = Buffer.from(hkdfSync('sha256', password, HKDF_SALT, HKDF_INFO, AES_KEY_LENGTH))
  return _derivedKey
}

/**
 * Decrypt a bytea payload produced by apps/web's encryptCredentials.
 * Returns null if the payload is too short to be valid (defensive guard).
 * Throws if GCM auth tag verification fails (tampered or wrong key — most
 * commonly a rotated IRON_SESSION_PASSWORD; see apps/web's repo for the
 * documented trade-off).
 */
export function decryptOffSiteCredentials(payload: Uint8Array, password: string): string | null {
  const buf = Buffer.from(payload)
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    return null
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  const key = getEncryptionKey(password)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}
