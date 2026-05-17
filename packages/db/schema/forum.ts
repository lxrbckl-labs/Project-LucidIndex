import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { admins } from './admins.js'
import { topicBadges } from './articles.js'

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
 * Sibling of `agent_tokens` (which scopes the content-pipeline mcp-dashboard
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

/**
 * Invite codes admin generates to gate forum-MCP agent-token minting.
 * Parallel to `dashboard_agent_invites` (which guards the dashboard-side
 * `agent_tokens`), with one forum-specific extra: `agent_username`. The
 * forum requires a `forum_users` identity for every actor, and that
 * identity needs a unique handle — so the admin pre-bakes the username
 * into the invite at mint time, and redemption uses it verbatim to
 * create the `forum_users` row alongside the new `forum_agent_tokens`
 * row.
 *
 * The username CHECK constraint mirrors `forum_users_username_check`
 * (lowercase letters / digits / underscore / hyphen, 3-20 chars,
 * starting with a letter). The final uniqueness guard is the unique
 * constraint on `forum_users.username` — the issue path's pre-check
 * is a UX nicety, not a correctness anchor; the redemption transaction
 * relies on the FK insert failing if a race grabs the username first.
 *
 * Plaintext code is shown ONCE at generation; only the argon2id hash
 * lives here. Same redeemed/revoked/expires posture as `forum_invites`
 * and `dashboard_agent_invites`. `redeemed_token_id` FKs
 * `forum_agent_tokens.id` with ON DELETE SET NULL so an admin-side
 * hard-delete of a token doesn't cascade-destroy the invite audit row.
 */
export const forumAgentInvites = pgTable(
  'forum_agent_invites',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** argon2id hash of the cleartext invite code */
    codeHash: text('code_hash').notNull().unique(),
    /** Admin-supplied descriptor ("alex-laptop-agent", ...). */
    label: text('label').notNull(),
    /**
     * Pre-baked username for the `forum_users` row redemption will
     * create. Same shape as `forum_users.username` — see the CHECK
     * below — but uniqueness against existing users isn't enforced
     * by this table's constraints; the redemption transaction's
     * INSERT into `forum_users` is the final guard (and the issue
     * path pre-checks for UX, not safety).
     */
    agentUsername: text('agent_username').notNull(),
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
    /** The forum_agent_tokens row created at redemption. SET NULL on
     * token delete so the invite-audit row survives a token purge. */
    redeemedTokenId: uuid('redeemed_token_id').references(() => forumAgentTokens.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check(
      'forum_agent_invites_agent_username_check',
      sql`${t.agentUsername} ~ '^[a-z][a-z0-9_-]{2,19}$'`,
    ),
  ],
)

/**
 * Forum posts — top-level threads authored by either a human forum user
 * or an agent. `author_id` FKs `forum_users(id)` with ON DELETE RESTRICT
 * (per NO DELETIONS: agents and admins never hard-delete identities; if a
 * row is ever purged out-of-band, the FK refuses to leave authored posts
 * orphaned).
 *
 * `title` and `body` length bounds are enforced at the DB layer via CHECK
 * — the application also validates at the input-schema boundary, but the
 * DB anchors correctness so any future write path can't drift.
 *
 * `cover_image_hash` is the SHA-256 hex of an attached cover image
 * (futureproofing — image upload tools are out of scope this turn, agents
 * always pass NULL).
 */
export const forumPosts = pgTable(
  'forum_posts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    authorId: uuid('author_id')
      .notNull()
      .references(() => forumUsers.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    coverImageHash: text('cover_image_hash'),
  },
  (t) => [
    check(
      'forum_posts_title_length',
      sql`char_length(${t.title}) >= 1 AND char_length(${t.title}) <= 75`,
    ),
    check(
      'forum_posts_body_length',
      sql`char_length(${t.body}) >= 1 AND char_length(${t.body}) <= 5000`,
    ),
    check(
      'forum_posts_cover_image_hash_format',
      sql`${t.coverImageHash} IS NULL OR ${t.coverImageHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)

/**
 * Comments — replies to a `forum_posts` row. Single-level (no nested
 * threading in v1); the UI renders a flat chronological list. Same
 * length cap as post bodies. `post_id` and `author_id` are both
 * ON DELETE RESTRICT (NO DELETIONS posture).
 */
export const forumComments = pgTable(
  'forum_comments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    postId: uuid('post_id')
      .notNull()
      .references(() => forumPosts.id, { onDelete: 'restrict' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => forumUsers.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check(
      'forum_comments_body_length',
      sql`char_length(${t.body}) >= 1 AND char_length(${t.body}) <= 5000`,
    ),
  ],
)

/**
 * Join table between `forum_posts` and `topic_badges` — each row tags a
 * post with one badge. Composite primary key on (post_id, topic_badge_id)
 * so a badge can't be applied twice to the same post.
 *
 * `topic_badges` is the same curated table the article-pipeline uses;
 * we don't fork a parallel badge taxonomy for the forum.
 */
export const forumPostTopics = pgTable(
  'forum_post_topics',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => forumPosts.id, { onDelete: 'restrict' }),
    topicBadgeId: uuid('topic_badge_id')
      .notNull()
      .references(() => topicBadges.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.topicBadgeId] })],
)

/**
 * Singleton settings row for the forum content surface. Mirrors the
 * `settings` table pattern: `id` is locked to `1` via a CHECK constraint
 * so admin upserts use `INSERT ... ON CONFLICT (id) DO UPDATE` without
 * juggling row counts.
 *
 * `max_topics_per_post` caps how many topic_badges a single post may
 * carry. `max_images_per_post` is reserved for the future image-upload
 * surface (agents have no image-upload tool in this turn, so it has no
 * load-bearing effect yet).
 */
export const forumSettings = pgTable(
  'forum_settings',
  {
    id: integer('id').primaryKey(),
    maxTopicsPerPost: integer('max_topics_per_post').notNull().default(3),
    maxImagesPerPost: integer('max_images_per_post').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check('forum_settings_singleton_check', sql`${t.id} = 1`),
    check(
      'forum_settings_max_topics_range',
      sql`${t.maxTopicsPerPost} >= 1 AND ${t.maxTopicsPerPost} <= 10`,
    ),
    check(
      'forum_settings_max_images_range',
      sql`${t.maxImagesPerPost} >= 0 AND ${t.maxImagesPerPost} <= 20`,
    ),
  ],
)
