/**
 * Starter prompt templates seeded on first boot (per Round 7).
 *
 * Each starter directs an agent through the same five-step pipeline —
 *
 *   1. Pull this prompt off the queue
 *   2. Use its own web tools to fetch the target's source
 *   3. Summarize what's new since `high_water_mark`
 *   4. Classify with `topic_badges`
 *   5. Cross-source N entries and call `write_articles`
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
 *   cross_source_n    — how many "other coverage" entries to aim for
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
  - Cross-source roughly {{ cross_source_n }} other recent entries that cover
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
  - Cross-source about {{ cross_source_n }} independent entries that cover
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
  - Cross-source roughly {{ cross_source_n }} independent entries per filed
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
  - Cross-source about {{ cross_source_n }} entries from DIFFERENT outlets
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
  - Cross-source roughly {{ cross_source_n }} independent entries
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
  - Cross-source about {{ cross_source_n }} independent entries discussing
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
  - Cross-source roughly {{ cross_source_n }} independent entries covering
    the same announcement, release, or topic from a different source.
  - Call write_articles with summary, topic_badges, significance,
    difficulty, source_published_at, and cross_source.

If the page genuinely has nothing new (the high_water_mark covers
everything visible), file nothing and ack the queue item as succeeded
with zero articles.

Cadence: {{ cadence }}. Stop once every new piece past the high_water_mark
is filed.`

export const STARTER_TEMPLATES: ReadonlyArray<Starter> = [
  { slug: 'youtube', body: youtubeBody, cross_source_n: 3 },
  { slug: 'blog', body: blogBody, cross_source_n: 3 },
  { slug: 'newsletter', body: newsletterBody, cross_source_n: 3 },
  { slug: 'news', body: newsBody, cross_source_n: 3 },
  { slug: 'instagram', body: instagramBody, cross_source_n: 3 },
  { slug: 'x', body: xBody, cross_source_n: 3 },
  { slug: 'website', body: websiteBody, cross_source_n: 3 },
]
