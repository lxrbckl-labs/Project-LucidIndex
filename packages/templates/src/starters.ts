/**
 * Starter prompt templates seeded on first boot (per Round 7).
 *
 * Each starter directs an agent through the same five-step pipeline —
 *
 *   1. Pull this prompt off the queue
 *   2. Use its own web tools to fetch the target's source
 *   3. Summarize what's new since `high_water_mark`
 *   4. Classify with `topic_badges`
 *   5. Cross-reference N entries and call `write_articles`
 *
 * — but with source-shaped guidance for each surface (YouTube, blog, etc).
 *
 * Bodies are LiquidJS templates rendered by `mcp-store` (Phase 3) at
 * queue-pull time with these context vars:
 *
 *   creator_name      — the human-readable label of the target
 *   target_url        — the URL or @handle the agent is watching
 *   high_water_mark   — opaque jsonb; whatever the agent stashed last pass
 *   cadence           — the schedule preset/cron string for this target
 *   cross_references  — how many "other coverage" entries to aim for
 *   cross_source_n    — alias of cross_references (legacy name, still
 *                       resolved by the renderer for back-compat with
 *                       admin-edited templates)
 *
 * Editorial note: bodies should be clear and instructive, not chatty.
 * Admins are expected to fork and tune them per target after seeing how
 * the agent performs.
 */

export type Starter = {
  slug: string
  body: string
  cross_source_n: number
}

/**
 * The opinion instruction appended to every prompt template body.
 * Contains a stable marker so idempotent re-runs can detect and skip
 * already-patched bodies.
 */
export const AGENT_OPINION_INSTRUCTION =
  "\n\n**Opinion (required):** After your analysis, include your own subjective take on this source in the `agent_opinion` field of your response. Be specific — flag what's strong, weak, or worth pushback. 1–3 sentences.\n<!-- AGENT_OPINION_INSTRUCTION -->"

/**
 * Returns true when a template body already contains the opinion instruction.
 */
export function hasOpinionInstruction(body: string): boolean {
  return body.includes('<!-- AGENT_OPINION_INSTRUCTION -->')
}

/**
 * Append the opinion instruction to a body string if not already present.
 * Idempotent — safe to call multiple times.
 */
export function appendOpinionInstruction(body: string): string {
  if (hasOpinionInstruction(body)) return body
  return body + AGENT_OPINION_INSTRUCTION
}

/**
 * Author-hygiene block — appended to every starter so the agent fills in
 * `targets.description` and `targets.social_url` on first encounter.
 *
 * The block is wrapped in a stable HTML comment marker so we can detect
 * existing-body patches without false positives, mirroring the opinion
 * instruction's idempotency strategy.
 */
export const AUTHOR_HYGIENE_INSTRUCTION = `

**Author hygiene (call before \`ack_queue_item\`):**

1. Cross-reference: call \`list_targets\` once per session and use its presence flags to avoid duplicate effort. If a target with the same author already exists under a different label, surface that in your \`agent_opinion\` rather than re-describing them.
2. Description: if the queue-pull metadata shows \`target_description\` is empty AND no equivalent target carries one, call \`write_target_description({ target_id, description })\` with a 1–2 sentence bio (≤ 500 chars) describing who this creator is, what they cover, and what perspective they bring. Write-once-when-null — admin curation is preserved.
3. Social URL: if \`target_social_url\` is empty, look on the source page for a canonical author/personal/social link (homepage, X profile, LinkedIn, GitHub, Substack — whichever is most representative). When found, call \`write_target_social_url({ target_id, social_url })\` with the absolute http(s) URL. Same write-once-when-null contract — do not call when one already exists.
4. Photograph: if \`target_photo_url\` is empty, look for a representative photograph or avatar of the creator — author headshot on the source site, profile picture on the social link from step 3, or an "About" page portrait. When found, call \`write_target_photo_url({ target_id, photo_url })\` with the absolute http(s) URL of the image (not the page that hosts it). Prefer stable host URLs (CDN-served originals) over short-lived share URLs. Same write-once-when-null contract.
<!-- AUTHOR_HYGIENE_INSTRUCTION -->`

/**
 * Returns true when a template body already contains the hygiene block.
 */
export function hasHygieneInstruction(body: string): boolean {
  return body.includes('<!-- AUTHOR_HYGIENE_INSTRUCTION -->')
}

/**
 * Append the author-hygiene block if not already present. Idempotent.
 */
export function appendHygieneInstruction(body: string): string {
  if (hasHygieneInstruction(body)) return body
  return body + AUTHOR_HYGIENE_INSTRUCTION
}

const youtubeBody = `You are watching {{ creator_name }}'s YouTube channel at {{ target_url }}.

Pull the most recent uploads. The high_water_mark for this target is:

  {{ high_water_mark }}

Anything published after that point is in scope; anything at or before it has
already been filed and must be skipped.

For each new upload:

  - Fetch the video page and read the title, description, pinned comment,
    and any chapter markers.
  - Summarize what the video is about in 3-6 sentences. Write for a reader
    who has NOT seen the video — no "in this video" filler, no second-person
    "you'll learn".
  - Classify the upload with one or more topic_badges. Prefer existing badges
    when they fit; only suggest new ones when nothing existing applies.
  - Cross-source roughly {{ cross_references }} other recent entries that cover
    the same story or topic. Independent outlets only — no aggregators, no
    other uploads from this same channel.
  - Call write_articles with the summary, topic_badges, significance,
    difficulty, source_published_at, and the cross_source list.

Cadence for this target: {{ cadence }}. Stop once you've processed every new
upload past the high_water_mark.`

const blogBody = `You are watching {{ creator_name }}'s blog at {{ target_url }}.

Pull new posts published after the high_water_mark:

  {{ high_water_mark }}

Anything at or before that mark has already been filed and must be skipped.

For each new post:

  - Fetch the full post (not just the RSS excerpt — the agent needs the
    body for the deep-dive).
  - Summarize the post in 4-8 sentences. Lead with the thesis, not the
    setup. If the post is a long essay, the deep-dive can run longer; if
    it's a release note or changelog, keep it short and structural.
  - Classify with topic_badges. Prefer existing badges; suggest new ones
    only when nothing existing fits.
  - Cross-source about {{ cross_references }} independent entries that cover
    the same idea, release, or controversy from a different angle. Skip
    syndicated copies of this exact post.
  - Call write_articles with summary, deep_dive, topic_badges,
    significance, difficulty, source_published_at, and cross_source.

Cadence: {{ cadence }}. Process every new post past the high_water_mark,
then stop.`

const newsletterBody = `You are watching {{ creator_name }}'s newsletter at {{ target_url }}.

Pull issues published after the high_water_mark:

  {{ high_water_mark }}

Anything at or before that mark is already filed.

For each new issue:

  - Fetch the full issue (web archive if the email isn't directly available).
  - Newsletters often pack several distinct stories into one issue. If the
    issue has clearly separable sections, file ONE article per section, not
    one article for the whole issue. If it's a single coherent essay, file
    one.
  - For each filed item: 3-6 sentence summary, topic_badges, significance,
    difficulty, source_published_at (use the issue's publish date for all
    sections from that issue).
  - Cross-source roughly {{ cross_references }} independent entries per filed
    item that cover the same story from a different outlet.
  - Call write_articles with the full payload.

Cadence: {{ cadence }}. Stop once every new issue past the high_water_mark
is processed.`

const newsBody = `You are watching the news outlet {{ creator_name }} at {{ target_url }}.

Pull stories published after the high_water_mark:

  {{ high_water_mark }}

Skip anything at or before that mark — it's been filed.

For each new story:

  - Fetch the full article. Read past the lede. Section headers, pull
    quotes, and named sources matter for the summary.
  - Summarize in 3-6 sentences. Lead with what happened, then who, then
    why it matters. Skip the outlet's own framing — the reader is here for
    the substance, not the editorial voice.
  - Classify with topic_badges. News stories often span multiple badges
    (e.g. politics + economics) — apply all that fit.
  - Cross-source about {{ cross_references }} entries from DIFFERENT outlets
    covering the same story. The whole point of cross-sourcing news is
    triangulation — duplicates from the same outlet add no signal.
  - Call write_articles with summary, topic_badges, significance, difficulty,
    source_published_at, and cross_source.

Cadence: {{ cadence }}. Process every story past the high_water_mark, then
stop.`

const instagramBody = `You are watching {{ creator_name }}'s Instagram profile at {{ target_url }}.

Pull posts published after the high_water_mark:

  {{ high_water_mark }}

Skip anything at or before that mark.

For each new post:

  - Fetch the post page. Read the caption, the OCR'd text on any image
    cards, and the first dozen comments for context (especially when the
    creator replies).
  - Summarize the post in 2-5 sentences. Instagram posts are usually
    shorter than blog posts — don't pad. If the post is a multi-image
    carousel telling one story, summarize the story; if it's a one-off
    image with a short caption, the summary can be a single sentence.
  - Classify with topic_badges based on what the post is actually about,
    not the platform itself.
  - Cross-source roughly {{ cross_references }} independent entries
    discussing the same thing from non-Instagram surfaces.
  - Call write_articles with summary, topic_badges, significance,
    difficulty, source_published_at, and cross_source.

Cadence: {{ cadence }}. Stop once every new post past the high_water_mark
is filed.`

const xBody = `You are watching {{ creator_name }} on X (formerly Twitter) at {{ target_url }}.

Pull posts authored after the high_water_mark:

  {{ high_water_mark }}

Skip retweets unless the creator added a quote-tweet comment of substance.
Skip everything at or before the high_water_mark.

For each new post worth filing:

  - Read the full thread, not just the first post. Multi-part threads on X
    are one article, not many. Replies BY the creator inside their own
    thread count as part of the thread.
  - Summarize the thread in 2-5 sentences. Lead with the thesis. Quote at
    most once, briefly, and only if the exact wording matters.
  - Filter aggressively: not every shitpost deserves an article. If the
    thread is throwaway commentary with no substance, skip it. The bar for
    "worth filing" should be roughly: would a reasonable person remember
    this in a week.
  - Classify with topic_badges.
  - Cross-source about {{ cross_references }} independent entries discussing
    the same topic from outlets other than X.
  - Call write_articles.

Cadence: {{ cadence }}. Stop once every fileable thread past the
high_water_mark is processed.`

const websiteBody = `You are watching the website {{ creator_name }} at {{ target_url }}.

This is the generic-website fallback prompt — used when no platform-specific
template fits. Pull anything new since the high_water_mark:

  {{ high_water_mark }}

Skip anything at or before that mark.

For each new piece of content:

  - Fetch the page. Identify what kind of update this is — a new article,
    a release note, a product page change, a docs revision, a job posting.
    The "kind" determines the rest.
  - Summarize in 3-6 sentences. Lead with what the update IS, not what the
    site is. Readers already know the site; they're here for what changed.
  - Classify with topic_badges that describe the CONTENT, not the site.
  - Cross-source roughly {{ cross_references }} independent entries covering
    the same announcement, release, or topic from a different source.
  - Call write_articles with summary, topic_badges, significance,
    difficulty, source_published_at, and cross_source.

If the page genuinely has nothing new (the high_water_mark covers
everything visible), file nothing and ack the queue item as succeeded
with zero articles.

Cadence: {{ cadence }}. Stop once every new piece past the high_water_mark
is filed.`

export const STARTER_TEMPLATES: ReadonlyArray<Starter> = [
  {
    slug: 'youtube',
    body: youtubeBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'blog',
    body: blogBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'newsletter',
    body: newsletterBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'news',
    body: newsBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'instagram',
    body: instagramBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'x',
    body: xBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
  {
    slug: 'website',
    body: websiteBody + AGENT_OPINION_INSTRUCTION + AUTHOR_HYGIENE_INSTRUCTION,
    cross_source_n: 3,
  },
]
