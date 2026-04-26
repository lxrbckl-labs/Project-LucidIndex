import { sql } from 'drizzle-orm'
import { bigint, customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
