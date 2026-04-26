import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Postgres `bytea` mapped to `Uint8Array` in TS. (Re-declared here so each
 * schema module owns its own helpers — avoids circular re-exports across
 * schema files.)
 */
const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * Tokens issued to agents (one per agent). `token_hash` is argon2id of the
 * cleartext token; the cleartext is shown ONCE at creation in Settings →
 * Agent Tokens and never persisted. `label` doubles as the byline display
 * name on article pages ("Analysis by `<label>`" per Round 7).
 *
 * Per NO DELETIONS: revocation is `revoked_at = now()`, never a row delete.
 */
export const agentTokens = pgTable('agent_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

/**
 * Liquid prompt templates. Starter slugs are seeded on first boot in a
 * separate migration (#34) — this table just defines the shape.
 *
 * `cross_source_n` is the per-template default count of "other coverage"
 * entries the agent should aim for (Round 7).
 */
export const promptTemplates = pgTable('prompt_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  body: text('body').notNull(),
  crossSourceN: integer('cross_source_n').notNull().default(3),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
})

/**
 * Singleton settings row. `id` is locked to `1` via a CHECK constraint so the
 * app can `INSERT ... ON CONFLICT (id) DO UPDATE` without juggling row counts.
 *
 * `off_site_backup_credentials_encrypted` is admin-encrypted at rest (key
 * derivation TBD during implementation — see [[Backend]] § Backups).
 */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    strictMode: boolean('strict_mode').notNull().default(false),
    newArticleBadgeHours: integer('new_article_badge_hours').notNull().default(24),
    offSiteBackupRemote: text('off_site_backup_remote'),
    offSiteBackupCredentialsEncrypted: bytea('off_site_backup_credentials_encrypted'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [check('settings_singleton_check', sql`${t.id} = 1`)],
)
