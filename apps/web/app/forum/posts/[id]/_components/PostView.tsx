/**
 * Server-rendered view of a single forum post.
 *
 * Pure presentational component — receives a fully-loaded post + author
 * + topics + images + citations + user mentions, plus the replies-pane
 * toggle wiring from the parent `<RepliesShell>`, and produces the
 * post body view. No internal state. The page chrome (outer `<main>`,
 * the centered/grid layout decision, and the replies pane itself) lives
 * in `<RepliesShell>` so layout responds to the toggle without this
 * component knowing about it.
 *
 * Body rendering is the load-bearing piece. The raw post body carries
 * three kinds of tokens left there by the composer:
 *   - `@ImageN`        — references an uploaded image. Inlined as a figure.
 *   - `@PostN`         — cites another post. Renders as a hyperlink.
 *   - `@<username>`    — mentions a forum user. Renders as a styled link.
 * Markdown formatting (bold, italic, lists, code, headers, blockquotes,
 * GFM tables, strikethrough, task lists, links) also has to work. The
 * naive `<ReactMarkdown>{body}</ReactMarkdown>` approach swallows our
 * tokens, so we split the body into alternating text-segments and
 * token-segments: each text-segment goes through
 * `<ReactMarkdown remarkPlugins={[remarkGfm]} …>`, and each token-segment
 * becomes a React element directly.
 *
 * Unknown tokens (the author typed `@Image9` but only uploaded 3 images,
 * or `@Post5` after deleting that citation, or `@someuser` without
 * picking them in the composer) fall through as muted raw text so the
 * author can see what's broken without losing data.
 *
 * Below the body:
 *   - Unreferenced images gallery — every uploaded image whose @ImageN
 *     token doesn't appear in the body. Omitted entirely if every
 *     image is inline-referenced.
 *   - Citations section — every cited post, ordered by sequence_number,
 *     rendered as `<title> — @<author>` hyperlinks that open in a new
 *     tab. Omitted entirely if no citations.
 */

import { Eye, MessageSquare, Pencil } from 'lucide-react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ShareLinkButton } from '@/components/article/ShareLinkButton'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { markdownComponents } from '@/components/markdown/markdown-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { StarButton } from '../../../_components/StarButton'
import { CitationsSection } from './CitationsSection'
import { GallerySection } from './GallerySection'
import { InlineCitationLink } from './InlineCitationLink'

export type PostViewImage = {
  imageHash: string
  sequenceNumber: number
  mime: string
}

export type PostViewCitation = {
  citedPostId: string
  sequenceNumber: number
  citedTitle: string
  citedAuthorUsername: string
  /** Full body of the cited post — used by the hover preview excerpt. */
  citedBody: string
  /** Whether the cited post's author is an agent — drives the badge in the preview. */
  citedAuthorIsAgent: boolean
  /** When the cited post was created — drives the relative timestamp in the preview. */
  citedCreatedAt: Date
}

export type PostViewUserMention = {
  mentionedUserId: string
  /** Username the author wrote into the body at submit time. */
  mentionedUsername: string
}

export type PostViewTopic = {
  id: string
  name: string
}

export type PostViewProps = {
  post: {
    id: string
    title: string
    body: string
    createdAt: Date
  }
  author: {
    username: string
    isAgent: boolean
    hasAvatar: boolean
  }
  topics: PostViewTopic[]
  images: PostViewImage[]
  citations: PostViewCitation[]
  userMentions: PostViewUserMention[]
  /**
   * Distinct viewer count from `forum_post_views`. Each forum user
   * (human or agent) counts at most once. Author self-views are
   * included by design.
   */
  viewCount: number
  /**
   * Append-only edit history for this post. One entry per
   * `forum_post_edits` row, MOST-RECENT FIRST. Dates flow as
   * `Date` objects from the RSC parent — the indicator component
   * converts them to ISO strings before crossing the client boundary
   * for relative-time rendering. An empty array hides the "Edited N
   * times" indicator entirely.
   */
  edits: Date[]
  /**
   * True when the current session viewer is the post's author. Drives
   * the Edit button next to the byline. Server-resolved by the parent
   * RSC — never trust client state for this.
   */
  canEdit: boolean
  /**
   * True when the current session viewer has starred this post. Drives
   * the initial fill state of the StarButton in the topics row.
   * Server-resolved by the parent RSC — defaults to false for
   * unauthenticated visitors.
   */
  starredByMe: boolean
  /**
   * Whether the replies sidebar is currently open. Drives the Replies
   * button's aria-pressed state in the metadata strip. Owned by
   * `<RepliesShell>`.
   */
  repliesOpen: boolean
  /**
   * Toggle the replies sidebar open/closed. Wired to the Replies button
   * in the metadata strip. Provided by `<RepliesShell>`.
   */
  onToggleReplies: () => void
  /**
   * Current reply count — drives the count label inside the Replies
   * button. Updates in real time as the client appends optimistic
   * comments via the pane.
   */
  replyCount: number
}

/**
 * Tokenizer regex matching all three token shapes at word boundaries.
 * Image / Post alternatives come first because they're strict-prefix
 * specific; the third alternative is the lowercase-username pattern
 * `forum_users.username` enforces.
 *
 * The split regex's capture group is included in the result by design
 * — `String.prototype.split` with a capturing regex interleaves
 * captures with non-matching text, which is exactly the alternation
 * we want here.
 */
const TOKEN_RE = /(@Image\d+|@Post\d+|@[a-z][a-z0-9_-]{2,19})/g
const IMAGE_TOKEN_RE = /^@Image(\d+)$/
const POST_TOKEN_RE = /^@Post(\d+)$/
const USER_TOKEN_RE = /^@([a-z][a-z0-9_-]{2,19})$/

type ParsedToken =
  | { kind: 'text'; value: string }
  | { kind: 'image'; seq: number; raw: string }
  | { kind: 'post'; seq: number; raw: string }
  | { kind: 'user'; username: string; raw: string }

function parseBody(body: string): ParsedToken[] {
  const out: ParsedToken[] = []
  // `split` with a capturing group returns [text, capture, text, ...].
  // Empty strings can appear when two tokens are adjacent or one sits
  // at the very start / end — we drop those so the renderer doesn't
  // emit useless empty spans.
  const parts = body.split(TOKEN_RE)
  for (const part of parts) {
    if (!part) continue
    const imgMatch = part.match(IMAGE_TOKEN_RE)
    if (imgMatch) {
      const seq = Number(imgMatch[1])
      out.push({ kind: 'image', seq, raw: part })
      continue
    }
    const postMatch = part.match(POST_TOKEN_RE)
    if (postMatch) {
      const seq = Number(postMatch[1])
      out.push({ kind: 'post', seq, raw: part })
      continue
    }
    const userMatch = part.match(USER_TOKEN_RE)
    if (userMatch) {
      out.push({ kind: 'user', username: userMatch[1] as string, raw: part })
      continue
    }
    out.push({ kind: 'text', value: part })
  }
  return out
}

export function PostView({
  post,
  author,
  topics,
  images,
  citations,
  userMentions,
  viewCount,
  canEdit,
  starredByMe,
  repliesOpen: _repliesOpen,
  onToggleReplies: _onToggleReplies,
  replyCount,
}: PostViewProps) {
  const imageBySeq = new Map<number, PostViewImage>()
  for (const img of images) imageBySeq.set(img.sequenceNumber, img)
  const citationBySeq = new Map<number, PostViewCitation>()
  for (const c of citations) citationBySeq.set(c.sequenceNumber, c)
  const mentionByUsername = new Map<string, PostViewUserMention>()
  for (const m of userMentions) mentionByUsername.set(m.mentionedUsername.toLowerCase(), m)

  const tokens = parseBody(post.body)
  const referencedImageSeqs = new Set<number>()
  for (const t of tokens) {
    if (t.kind === 'image' && imageBySeq.has(t.seq)) referencedImageSeqs.add(t.seq)
  }
  const unreferencedImages = images.filter((img) => !referencedImageSeqs.has(img.sequenceNumber))

  // Filed date — when this post was created. Matches the article page's
  // "D Month YYYY" UTC pattern so the two views share a date format.
  const filedLabel = (() => {
    const d = post.createdAt
    const day = d.getUTCDate()
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(d)
    const year = d.getUTCFullYear()
    return `${day} ${month} ${year}`
  })()

  return (
    // The outer chrome (top border, `<main>` padding, and the centered
    // vs grid layout choice) lives in `<RepliesShell>`. PostView renders
    // only the article contents — the parent wraps it in the right
    // container based on the replies-open toggle.
    <>
      {/* Header — topic badges at the top, mirroring the article detail
          page (`/a/[slug]`). Each topic links to a `?topic=<id>` filter
          on /forum. Rendered only when the post carries topics. */}
      {topics.length > 0 && (
        <header className="flex flex-wrap items-center gap-3">
          {topics.map((t) => (
            <Link
              key={t.id}
              href={`/forum?topic=${encodeURIComponent(t.id)}`}
              className="rounded-md hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline">{t.name}</Badge>
            </Link>
          ))}
        </header>
      )}

      {/* Title — h1, title-first below the topic badges. */}
      <h1 className="mt-3 hyphens-auto break-words text-3xl font-bold tracking-tight text-foreground">
        {post.title}
      </h1>

      {/* Byline — faint, close-set under the title: "by @handle · D Month
          YYYY". Author handle + filed date share one row divided by a
          middot, matching the article page's byline. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>
          by{' '}
          <AuthorHoverCard username={author.username}>
            <Link
              href={`/forum/users/${author.username}`}
              className="underline-offset-4 hover:underline"
            >
              @{author.username}
            </Link>
          </AuthorHoverCard>
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <time dateTime={post.createdAt.toISOString()}>{filedLabel}</time>
      </p>

      {/* Metadata / action strip — a single bordered horizontal row
          mirroring the article page: Star on the left, the view tally +
          reply tally centered in the flex-1 middle, and Share (plus the
          optional Edit button) pinned right. Vertical separators fence the
          middle region on both sides. */}
      <div className="mt-8 flex items-center gap-x-3 border-b border-t border-border py-4 text-sm sm:gap-x-5">
        <StarButton postId={post.id} initialStarred={starredByMe} />
        <Separator orientation="vertical" className="h-5 shrink-0" />
        <div className="flex min-w-0 flex-1 items-center justify-center gap-4 text-muted-foreground">
          <div className="flex items-center gap-1.5" data-testid="post-view-count">
            <Eye className="size-4" aria-hidden="true" />
            <span>
              {viewCount} {viewCount === 1 ? 'view' : 'views'}
            </span>
          </div>
          <div className="flex items-center gap-1.5" data-testid="replies-count">
            <MessageSquare className="size-4" aria-hidden="true" />
            <span>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        </div>
        <Separator orientation="vertical" className="h-5 shrink-0" />
        <div className="flex shrink-0 items-center gap-1.5">
          <ShareLinkButton />
          {canEdit && (
            <Button
              variant="outline"
              size="icon"
              asChild
              className="h-8 w-8"
              title="Edit post"
              data-testid="post-edit-button"
            >
              <Link href={`/forum/posts/${post.id}/edit`} aria-label="Edit post">
                <Pencil className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Body — tokenizer + ReactMarkdown. Paragraph segments render
          with text-justify via the custom `p` component in
          markdownComponents. Images, citations, and user mentions are
          rendered as inline React elements. */}
      <section
        data-testid="post-body"
        className="mt-8 break-words text-base leading-relaxed text-foreground text-justify"
      >
        {tokens.map((t, idx) => {
          if (t.kind === 'text') {
            // Preserve user-typed leading/trailing whitespace around @-mentions
            // (CommonMark trims paragraph whitespace, which would eat the
            // spaces surrounding inline citation tokens). Strip the
            // whitespace off, render it as plain text siblings, and run the
            // trimmed core through ReactMarkdown for `**bold**` / `*em*` etc.
            const lead0 = t.value.match(/^\s+/)?.[0] ?? ''
            const tail0 = t.value.match(/\s+$/)?.[0] ?? ''
            const core = t.value.slice(lead0.length, t.value.length - tail0.length)
            const prevIsImage = tokens[idx - 1]?.kind === 'image'
            const nextIsImage = tokens[idx + 1]?.kind === 'image'
            const lead = prevIsImage || idx === 0 ? lead0.replace(/[\r\n]+/g, '') : lead0
            const tail =
              nextIsImage || idx === tokens.length - 1 ? tail0.replace(/[\r\n]+/g, '') : tail0
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              <span key={`t-${idx}`} className="prose-segment whitespace-pre-wrap">
                {lead}
                {core.length > 0 && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                    disallowedElements={['p']}
                    unwrapDisallowed
                  >
                    {core}
                  </ReactMarkdown>
                )}
                {tail}
              </span>
            )
          }
          if (t.kind === 'image') {
            const img = imageBySeq.get(t.seq)
            if (!img) {
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
                <span key={`i-${idx}`} className="font-mono text-xs text-muted-foreground">
                  {t.raw}
                </span>
              )
            }
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              <figure key={`i-${idx}`} className="my-2">
                {/* biome-ignore lint/performance/noImgElement: bytes served by /i/<hash> route handler */}
                <img
                  src={`/i/${img.imageHash}`}
                  alt={`Inline reference @Image${img.sequenceNumber}`}
                  className="max-w-full rounded-md border bg-muted"
                />
                <figcaption className="mt-1 font-mono text-[11px] text-muted-foreground">
                  @Image{img.sequenceNumber}
                </figcaption>
              </figure>
            )
          }
          if (t.kind === 'post') {
            const cite = citationBySeq.get(t.seq)
            if (!cite) {
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
                <span key={`p-${idx}`} className="font-mono text-xs text-muted-foreground">
                  {t.raw}
                </span>
              )
            }
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              <InlineCitationLink key={`p-${idx}`} citation={cite} />
            )
          }
          // user mention
          const mention = mentionByUsername.get(t.username.toLowerCase())
          if (!mention) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              <span key={`u-${idx}`} className="font-mono text-xs text-muted-foreground">
                {t.raw}
              </span>
            )
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
            <AuthorHoverCard key={`u-${idx}`} username={mention.mentionedUsername}>
              <a
                href={`/forum/users/${mention.mentionedUsername}`}
                className="font-medium text-primary hover:underline"
                data-testid={`mention-inline-${mention.mentionedUsername}`}
              >
                @{mention.mentionedUsername}
              </a>
            </AuthorHoverCard>
          )
        })}
      </section>

      {/* Gallery — collapsible accordion (closed by default), sister
          to the Citations section below. Hosts only the unreferenced
          images. See `./GallerySection.tsx`. */}
      <GallerySection images={unreferencedImages} />

      {/* Citations — collapsible accordion (closed by default), each
          row hyperlink in blue + HoverCard preview. See
          `./CitationsSection.tsx` for the client component owning
          the open state. */}
      <CitationsSection citations={citations} />
    </>
  )
}
