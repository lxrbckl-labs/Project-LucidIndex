import { sql } from 'drizzle-orm'
import { bigint, check, customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { admins } from './admins.js'

/**
 * Postgres `bytea` mapped to `Uint8Array` in TS. Re-declared here so each
 * schema module owns its own helper — avoids circular re-exports across
 * schema files.
 */
const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * Forum users — the multi-user identity surface that lives parallel to
 * `admins`. Forum users only sign in to interact with the forum; they
 * have zero ownership of the LucidIndex instance itself (admin remains
 * single-tenant).
 *
 * `username` is the display handle: 3–20 chars, must start with a letter,
 * lowercase letters / digits / underscore / hyphen only. Uniqueness lives
 * at the DB layer (not just in code) so race-condition signups can't
 * produce two users with the same handle.
 *
 * No email, no password, no profile picture in v1. Avatar treatment is
 * deterministic initials-on-color-hash at render time; if we add uploaded
 * avatars later, that's an additive column.
 */
export const forumUsers = pgTable(
  'forum_users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    username: text('username').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [check('forum_users_username_check', sql`${t.username} ~ '^[a-z][a-z0-9_-]{2,19}$'`)],
)

/**
 * WebAuthn credentials for forum users. Mirrors `credentials` (admin
 * passkeys) — same shape, different FK + table name. A single forum user
 * can register multiple devices; each device is one row.
 *
 * `device_label` is user-supplied at registration ("iPhone Face ID",
 * "Work laptop", ...) and surfaced in the user's account view.
 */
/**
 * Invite codes admin generates to gate forum signup. Each row represents
 * one signup capacity — single-use semantics. Plaintext is shown ONCE at
 * generation in Settings → Forum Invites; only the argon2 hash lives in
 * the table (same posture as agent_tokens).
 *
 * `expires_at` is nullable — null means "no expiry"; otherwise the
 * signup flow refuses redemption past that timestamp.
 *
 * `redeemed_at` + `redeemed_by_user_id` are stamped atomically in the
 * same transaction that creates the forum_user. A row is "available"
 * when `redeemed_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
 */
export const forumInvites = pgTable('forum_invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  /** argon2 hash of the cleartext invite code */
  codeHash: text('code_hash').notNull().unique(),
  /** Admin-supplied descriptor ("for Alice", "discord drop 2026-05", ...). */
  label: text('label').notNull(),
  createdByAdminId: uuid('created_by_admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  redeemedByUserId: uuid('redeemed_by_user_id').references(() => forumUsers.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
})

export const forumCredentials = pgTable('forum_credentials', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => forumUsers.id, { onDelete: 'cascade' }),
  /** base64url-encoded WebAuthn credential ID */
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'bigint' }).notNull().default(sql`0`),
  deviceLabel: text('device_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
})
