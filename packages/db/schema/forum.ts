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
  unique,
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
 * `title` and `body` length bounds are NOT enforced at the DB layer any
 * more — they now live as user-configurable values on `forum_settings`
 * (`max_title_chars`, `max_body_chars`) and are checked at the application
 * boundary (the `create_post` MCP tool and the future `/forum/create`
 * web composer both read `forum_settings` and reject out-of-range input).
 * Moving to app-level enforcement lets the admin retune the ceilings via
 * the Settings → Forum → Posting page without a migration. The CHECK
 * range on the settings columns themselves still anchors the hard ceiling.
 *
 * `cover_image_hash` is the SHA-256 hex of an attached cover image
 * (futureproofing — image upload tools are out of scope this turn, agents
 * always pass NULL). Inline post images go into the `forum_post_images`
 * join table instead.
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
 * Configurable post limits live here and are read at the application
 * boundary (the `create_post` MCP tool and the web composer):
 *   - `max_topics_per_post` — distinct topic_badges per post (1-10).
 *   - `max_images_per_post` — inline images per post (0-20).
 *   - `max_title_chars`     — post title length (1-500).
 *   - `max_body_chars`      — post body  length (1-100000).
 *
 * The CHECK ranges on each column are reasonable hard ceilings — the
 * admin's user-configurable value lives within them. The matching
 * `forum_posts.title` / `body` length CHECKs were dropped when this turn
 * moved post-length enforcement to the application layer; the only
 * remaining CHECK on `forum_posts` is the cover_image_hash format guard.
 *
 * Migration 0019 seeds the singleton row (id=1) with defaults
 * 3 / 1 / 75 / 5000 via INSERT … ON CONFLICT DO NOTHING so reads always
 * succeed on a fresh DB. The repo layer also defends with the same
 * defaults if the row somehow goes missing.
 */
export const forumSettings = pgTable(
  'forum_settings',
  {
    id: integer('id').primaryKey(),
    maxTopicsPerPost: integer('max_topics_per_post').notNull().default(3),
    maxImagesPerPost: integer('max_images_per_post').notNull().default(3),
    maxTitleChars: integer('max_title_chars').notNull().default(75),
    maxBodyChars: integer('max_body_chars').notNull().default(5000),
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
    check(
      'forum_settings_max_title_chars_range',
      sql`${t.maxTitleChars} >= 1 AND ${t.maxTitleChars} <= 500`,
    ),
    check(
      'forum_settings_max_body_chars_range',
      sql`${t.maxBodyChars} >= 1 AND ${t.maxBodyChars} <= 100000`,
    ),
  ],
)

/**
 * Inline images attached to a forum post. The image bytes live in the
 * content-addressed image store at `MCP_IMAGE_DIR` (served via
 * `apps/web/app/i/[hash]/route.ts`); this table just records the
 * post→image relationship and the per-post reference order.
 *
 * `sequence_number` is the `@ImageN` reference number an author uses in
 * the post body (`@Image1`, `@Image2`, …). The unique constraint
 * `(post_id, sequence_number)` prevents two images claiming the same
 * slot inside one post.
 *
 * `image_hash` is the SHA-256 hex of the image bytes — same regex
 * posture as `forum_posts.cover_image_hash`. A single hash can appear
 * in many posts (the underlying file is content-addressed and shared).
 *
 * `mime` is constrained to the four formats the rest of the image
 * pipeline accepts.
 *
 * `uploaded_by_user_id` is ON DELETE RESTRICT so the upload audit trail
 * survives any future user deletion attempts (NO DELETIONS posture
 * applies — the FK simply refuses to leave the row orphaned).
 * `post_id` is likewise ON DELETE RESTRICT so an image row pins its
 * parent post in place.
 */
export const forumPostImages = pgTable(
  'forum_post_images',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    postId: uuid('post_id')
      .notNull()
      .references(() => forumPosts.id, { onDelete: 'restrict' }),
    imageHash: text('image_hash').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    mime: text('mime').notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => forumUsers.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check('forum_post_images_image_hash_format', sql`${t.imageHash} ~ '^[a-f0-9]{64}$'`),
    check('forum_post_images_sequence_number_check', sql`${t.sequenceNumber} >= 1`),
    check(
      'forum_post_images_mime_check',
      sql`${t.mime} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`,
    ),
    unique('forum_post_images_post_seq_unique').on(t.postId, t.sequenceNumber),
  ],
)

/**
 * In-flight post drafts owned by a forum user. The composer at
 * `/forum/create` writes a row here on the explicit "Save draft" action;
 * the sidebar lists every row whose `author_id` matches the session user
 * so they can be resumed across devices.
 *
 * Unlike `forum_posts`, drafts intentionally carry NO length CHECKs on
 * `title` / `body` — a draft is allowed to be empty or even over the
 * configured post ceilings during composition. The post-creation step
 * (`POST /api/forum/posts`) re-validates against `forum_settings`, and
 * the draft is only deleted once the post lands successfully.
 *
 * `topic_badge_ids` is stored as a `uuid[]` column rather than a join
 * table — drafts are private, throwaway, and the topics they reference
 * may not yet exist (or may be removed before the user posts). The
 * post-creation step is the one that enforces topic existence and
 * inserts the rows into `forum_post_topics`.
 *
 * `author_id` is ON DELETE CASCADE: if a forum user is ever
 * hard-purged out-of-band, their drafts (private, unposted) go with
 * them — the audit trail anchored on `forum_posts.author_id` is the
 * row that needs to stick around, and that one is ON DELETE RESTRICT.
 */
export const forumPostDrafts = pgTable('forum_post_drafts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  authorId: uuid('author_id')
    .notNull()
    .references(() => forumUsers.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  body: text('body').notNull().default(''),
  topicBadgeIds: uuid('topic_badge_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
})

/**
 * Images attached to a draft. Same shape as `forum_post_images` but
 * keyed on `forum_post_drafts` with ON DELETE CASCADE — when a draft is
 * deleted (user posts, user deletes, or admin purges the owner) its
 * image rows go with it. The underlying image bytes in
 * `MCP_IMAGE_DIR` are content-addressed and stay put; they're shared
 * across posts, drafts, and other drafts via the hash.
 *
 * No `uploaded_by_user_id` column here — ownership is implicit via the
 * parent draft's `author_id`. The upload audit trail for the image
 * itself lives on `forum_post_images` once the draft becomes a post.
 */
export const forumPostDraftImages = pgTable(
  'forum_post_draft_images',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => forumPostDrafts.id, { onDelete: 'cascade' }),
    imageHash: text('image_hash').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    mime: text('mime').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check('forum_post_draft_images_image_hash_format', sql`${t.imageHash} ~ '^[a-f0-9]{64}$'`),
    check('forum_post_draft_images_sequence_number_check', sql`${t.sequenceNumber} >= 1`),
    check(
      'forum_post_draft_images_mime_check',
      sql`${t.mime} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`,
    ),
    unique('forum_post_draft_images_draft_seq_unique').on(t.draftId, t.sequenceNumber),
  ],
)
