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
import { admins } from './admins.js'

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
 * Invite codes admin generates to gate Dashboard-MCP agent-token minting.
 * Each row represents one bearer-token capacity — single-use semantics.
 * Plaintext is shown ONCE at generation in Settings → Dashboard → Agent
 * Invites; only the argon2id hash lives in the table (same posture as
 * `forum_invites` and `agent_tokens`).
 *
 * On redemption, the API server atomically inserts a fresh row in
 * `agent_tokens` (whose cleartext bearer is returned exactly once),
 * stamps `redeemed_at = now()`, and links `redeemed_token_id` to the new
 * `agent_tokens.id`. The newly-minted token row is functionally
 * indistinguishable from one minted directly via Settings → Agent Tokens
 * — the invite is just metadata about HOW the token was minted.
 *
 * `expires_at` is nullable — null means "no expiry"; redemption refuses
 * past the timestamp otherwise.
 *
 * `revoked_at` is set when admin manually invalidates an unredeemed
 * invite. A row is "available" when ALL of:
 *   redeemed_at IS NULL
 *   AND revoked_at IS NULL
 *   AND (expires_at IS NULL OR expires_at > now())
 *
 * `created_by_admin_id` is nullable so the dev-bypass path
 * (LUCIDINDEX_DEV_SKIP_AUTH=1, no real admin row in DB) can still record
 * audit data without failing the FK — matches `forum_invites`.
 *
 * `redeemed_token_id` FKs `agent_tokens.id` with ON DELETE SET NULL so
 * an admin-side hard-delete of a token doesn't cascade-destroy the
 * audit-history invite row.
 */
export const dashboardAgentInvites = pgTable('dashboard_agent_invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  /** argon2id hash of the cleartext invite code */
  codeHash: text('code_hash').notNull().unique(),
  /** Admin-supplied descriptor ("for partner-agent", "for-vendor", ...). */
  label: text('label').notNull(),
  /**
   * Admin who issued the invite. Nullable so the dev-bypass path
   * (LUCIDINDEX_DEV_SKIP_AUTH=1, no real admin row in DB) can still
   * record audit data without failing the FK.
   */
  createdByAdminId: uuid('created_by_admin_id').references(() => admins.id, {
    onDelete: 'set null',
  }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  /** The agent_tokens row created at redemption. SET NULL on token
   * delete so the invite-audit row survives a token purge. */
  redeemedTokenId: uuid('redeemed_token_id').references(() => agentTokens.id, {
    onDelete: 'set null',
  }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
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
