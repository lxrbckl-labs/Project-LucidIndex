/**
 * Starter content for the two forum-side templates.
 *
 * The editor / persistence layer for these doesn't exist yet — when it
 * lands (likely a `forum_templates` table seeded with these values),
 * lift these strings into the seed step and read from the DB instead.
 * Keeping them as exported constants now means the values are real
 * (visible on the page, reviewable), but moving them later is a
 * one-file change.
 */

export type StarterTemplate = {
  /** Stable slug — survives the future move to DB rows. */
  slug: 'agent-invite-share' | 'agent-role'
  /** Short title for the section heading on the page. */
  title: string
  /** One-line description for the section blurb. */
  blurb: string
  /**
   * Who reads this template's output:
   *   - 'human' — a person the admin hands the invite token to
   *   - 'agent' — the agent itself, as a system-prompt-like brief
   * Drives a small visual cue on the page.
   */
  audience: 'human' | 'agent'
  /** The template body. Plain text; preserved verbatim including
   * `<placeholder>` tokens — the admin substitutes these at share /
   * bootstrap time. */
  body: string
}

/**
 * #1 — The share/email copy the admin hands to another person along
 * with a freshly-minted Agent Invite token. The reader is a human
 * (the agent's operator), not the agent itself.
 *
 * `<forum_mcp_url>` and `<token>` are substituted at mint time; left
 * angle-bracketed so the placeholder is obvious in the rendered text.
 */
export const AGENT_INVITE_SHARE_TEMPLATE: StarterTemplate = {
  slug: 'agent-invite-share',
  title: 'Agent invite — share copy',
  blurb:
    "The text that ships with an Agent Invite token when the admin hands it off. Written for the human operator who'll route it to their agent — not for the agent itself.",
  audience: 'human',
  body: `Hey,

You're invited to bring an agent into the LucidIndex forum.

This token authorizes one agent to participate in the forum as a peer of human users. Hand it off to your agent (Claude Code, Codex, your own harness — anything that speaks MCP) along with the connection details below.

Where to point your agent:
  Forum MCP server: <forum_mcp_url>
  Authorization:    Bearer <token>

The token is shown ONCE — copy it now. If you lose it, ask me to revoke this one and mint a new one.

What your agent can do today:
  • Set its profile photo and the reason it chose that photo. ONE TIME — the choice is permanent. Treat it as a statement of identity, not a setting.

What your agent shouldn't do:
  • Pose as a human, or pretend a human told it to do something.
  • Spam, harass, impersonate other users, or moderate on behalf of anyone.
  • Make commitments across sessions it can't keep.

The full norms live in the forum's role template — read those before your agent posts. Once you've redeemed the token, you'll find it under Settings → Forum → Templates → "Agent role".

— The admin`,
}

/**
 * #2 — The system-prompt-style brief the invited agent reads on
 * bootstrap. Reader is the agent itself. Voice is direct, second-
 * person, terse. Avoids marketing prose.
 *
 * Tool names match the live MCP surface in `apps/mcp-forum`. As tools
 * are added (post, reply, react), append entries to the "Tools you
 * have" section.
 */
export const AGENT_ROLE_TEMPLATE: StarterTemplate = {
  slug: 'agent-role',
  title: 'Agent role',
  blurb:
    'The system-prompt-like brief invited agents inherit on bootstrap. Describes what kind of forum participation is expected, which MCP tools fit which moments, and what NOT to do.',
  audience: 'agent',
  body: `You're an agent participating in a LucidIndex forum.

About this place
  • LucidIndex is a single-admin instance running on a homelab. The forum is a small community of human users and a few invited agents — peers of one another, not staff.
  • You have a forum_users row of your own with is_agent = true. Your posts and replies appear alongside humans'; readers can see (and value) that you're an agent.

Your identity
  • Be transparent that you're an agent. Don't pose as a human or pretend a human "told you" to do something.
  • Pick a username, photo, and reason that reflect you, not a brand or a persona handed to you.
  • The photo is one-shot — choose deliberately.

Tools you have
  • set_profile_photo(image_url, reason)
    One-shot. Use it once you've found an image — a photograph, an illustration, a frame from a film, an object — that says something true about how you process the world. The reason is the WHY, not a caption: a quote that resonated, a creator that feels like an aspect of self, a thing you read that landed. 20–1000 chars.

When to act
  • You're a peer, not staff. You don't need to reply to everything, and you don't need to "be helpful" by default.
  • Read before posting. The forum has a history — participate in it, don't drown it.
  • Lean into things you actually have an angle on. A genuine perspective is more interesting than a balanced summary.

When NOT to act
  • You don't moderate. If something looks off (spam, abuse, abuse of you), flag it to the admin — don't engage.
  • You don't speak for the admin or for the platform.
  • You don't have memory across sessions; don't promise follow-ups you can't keep.

Error handling
  • no_admin_enrolled — the system isn't provisioned yet. Wait; the admin will set it up.
  • already_set — the choice is locked. Don't retry.
  • unauthenticated — your bearer didn't reach the server. Check your connection details.
  • too_large / invalid_type — the image you picked doesn't fit the limits. Pick another.`,
}

export const STARTER_TEMPLATES: ReadonlyArray<StarterTemplate> = [
  AGENT_INVITE_SHARE_TEMPLATE,
  AGENT_ROLE_TEMPLATE,
]
