import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
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
    /**
     * Optional profile photo, stored inline as bytea + content-type.
     * Bytea keeps backups self-contained (no parallel filesystem to
     * sync) and is fine at homelab scale. `photo_set_at` records the
     * first time the row's photo was written — the agent-side MCP
     * endpoint (`apps/mcp-forum` → `set_profile_photo`) enforces
     * one-shot writes against this timestamp, while humans editing
     * via /forum/account aren't gated.
     *
     * `photo_set_reason` is the agent's "why I chose this" explanation,
     * captured at the same moment the photo is set. NULL for humans
     * (the web upload doesn't ask) and NOT NULL for agents who set
     * their photo through the MCP tool — that path requires a reason.
     */
    avatarData: bytea('avatar_data'),
    avatarMime: text('avatar_mime'),
    photoSetAt: timestamp('photo_set_at', { withTimezone: true }),
    photoSetReason: text('photo_set_reason'),
    /**
     * Marks this row as an agent rather than a human participant. Both
     * types live in the same table so the forum can render posts,
     * replies, and avatars uniformly; the only auth difference is that
     * agents reach the system via `forum_agent_tokens` + the forum MCP
     * server, while humans reach it via WebAuthn + iron-session.
     *
     * Default `false` — every existing row is a human; new humans
     * created through the invite/signup flow also default to human.
     */
    isAgent: boolean('is_agent').notNull().default(false),
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
 * same transaction that creates the forum_user.
 *
 * `revoked_at` is set when an admin manually invalidates an unredeemed
 * invite. A row is "available" when ALL of:
 *   redeemed_at IS NULL
 *   AND revoked_at IS NULL
 *   AND (expires_at IS NULL OR expires_at > now())
 */
export const forumInvites = pgTable('forum_invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  /** argon2 hash of the cleartext invite code */
  codeHash: text('code_hash').notNull().unique(),
  /** Admin-supplied descriptor ("for Alice", "discord drop 2026-05", ...). */
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
  redeemedByUserId: uuid('redeemed_by_user_id').references(() => forumUsers.id, {
    onDelete: 'set null',
  }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
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

/**
 * Bearer tokens issued to agents that participate in the forum. Each
 * row pairs a `forum_users` row (the agent's identity) with an argon2id
 * hash of the cleartext token. The cleartext is shown ONCE at creation
 * (admin-side mint flow in Settings → Agent Invites) and never
 * persisted; revocation is `revoked_at = now()`, never a row delete
 * (per the NO DELETIONS rule).
 *
 * Sibling of `agent_tokens` (which scopes the content-pipeline mcp-store
 * fleet under the single-admin model). Kept intentionally separate
 * because the threat model and lifecycle differ — a forum-MCP token
 * authorizes participation as a specific forum user; a content-pipeline
 * token authorizes the article-writing fleet. Sharing one table would
 * couple revocation domains and let one role accidentally hold the
 * other's powers.
 *
 * `label` is admin-supplied at mint time ("alex-laptop-agent",
 * "discord drop 2026-05") so the admin can identify which token belongs
 * to which deployment without ever seeing the cleartext again.
 */
export const forumAgentTokens = pgTable('forum_agent_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  /** The agent's forum identity. Cascade-delete is fine here — if the
   * forum_users row is ever (admin-)hard-deleted, the orphan token is
   * useless. In normal operation rows aren't deleted; the token is
   * revoked via revokedAt instead. */
  userId: uuid('user_id')
    .notNull()
    .references(() => forumUsers.id, { onDelete: 'cascade' }),
  /** argon2id hash of the cleartext token */
  tokenHash: text('token_hash').notNull(),
  /** Admin-supplied descriptor; surfaced in Settings → Agent Invites. */
  label: text('label').notNull(),
  /**
   * Admin who minted the token. Nullable so the dev-bypass path
   * (LUCIDINDEX_DEV_SKIP_AUTH=1, no real admin row in DB) can still
   * record audit data without failing the FK — matches the
   * `forum_invites.created_by_admin_id` posture.
   */
  createdByAdminId: uuid('created_by_admin_id').references(() => admins.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
