import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  customType,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Postgres `bytea` mapped to `Uint8Array` in TS.
 * drizzle-orm doesn't ship a first-class bytea helper yet (as of 0.45.x),
 * so we use customType to keep the column typed and migration-friendly.
 */
const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  /**
   * Hash of the founding-token used to register the very first admin.
   * Set on the founding admin's row at registration; nulled out once
   * recovery codes are minted. Always null on subsequent admins.
   */
  foundingTokenHash: text('founding_token_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
})

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  /** base64url-encoded WebAuthn credential ID */
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'bigint' }).notNull().default(sql`0`),
  /** Admin-supplied label at registration ("iPhone Face ID", "MacBook TouchID", ...). */
  deviceLabel: text('device_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
})

export const recoveryCodes = pgTable('recovery_codes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  /** argon2 hash of the (one-time) recovery code */
  codeHash: text('code_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
})

/**
 * Audit log of every auth-relevant event. Surfaces in Settings → System and
 * (eventually) admin-side tooling. Append-only; nothing in the app deletes rows.
 *
 * Design notes:
 * - `admin_id` is nullable: pre-admin attempts (e.g. failed founding-claim
 *   attempts, login attempts that miss any credential) have no admin to point at.
 * - `kind` is constrained via a CHECK constraint (not a Postgres enum) to keep
 *   future kind additions a single-line migration instead of an `ALTER TYPE`.
 * - `details` is freeform jsonb so the surface can carry context (IP, user
 *   agent, attempted credential id, etc.) without us pre-committing to a schema.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check(
      'auth_events_kind_check',
      sql`${t.kind} in ('founding_claim', 'passkey_register', 'passkey_login', 'recovery_used', 'recovery_regenerated', 'admin_reset', 'failed_passkey_login', 'failed_founding_claim')`,
    ),
  ],
)
