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
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ShareLinkButton } from '@/components/article/ShareLinkButton'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CitationsSection } from './CitationsSection'
import { EditHistoryIndicator } from './EditHistoryIndicator'
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

/**
 * Component map for ReactMarkdown. Customizes:
 *  - `a` — external links (http(s) NOT on the current origin) open in a
 *    new tab with noopener/noreferrer. Internal links stay default.
 *    SSR doesn't know the origin reliably, so we treat any `http(s)://`
 *    href as external — internal app routes use relative hrefs.
 *  - `code` / `pre` — inline + fenced code get muted styling that picks
 *    up the surrounding theme tokens (no separate prose plugin).
 *  - `table` — wrapped in an overflow container so wide tables don't
 *    break the layout on narrow screens.
 */
const markdownComponents = {
  a({ href, children, ...rest }: ComponentPropsWithoutRef<'a'> & { children?: ReactNode }) {
    const h = typeof href === 'string' ? href : ''
    const isExternal = /^https?:\/\//i.test(h)
    if (isExternal) {
      return (
        <a
          {...rest}
          href={h}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {children}
        </a>
      )
    }
    return (
      <a {...rest} href={h} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </a>
    )
  },
  code({ children, ...rest }: ComponentPropsWithoutRef<'code'> & { children?: ReactNode }) {
    return (
      <code
        {...rest}
        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
      >
        {children}
      </code>
    )
  },
  pre({ children, ...rest }: ComponentPropsWithoutRef<'pre'> & { children?: ReactNode }) {
    return (
      <pre
        {...rest}
        className="my-3 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs"
      >
        {children}
      </pre>
    )
  },
  blockquote({
    children,
    ...rest
  }: ComponentPropsWithoutRef<'blockquote'> & { children?: ReactNode }) {
    return (
      <blockquote
        {...rest}
        className="my-3 border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground"
      >
        {children}
      </blockquote>
    )
  },
  table({ children, ...rest }: ComponentPropsWithoutRef<'table'> & { children?: ReactNode }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table {...rest} className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    )
  },
  th({ children, ...rest }: ComponentPropsWithoutRef<'th'> & { children?: ReactNode }) {
    return (
      <th {...rest} className="border-b px-2 py-1 text-left font-semibold">
        {children}
      </th>
    )
  },
  td({ children, ...rest }: ComponentPropsWithoutRef<'td'> & { children?: ReactNode }) {
    return (
      <td {...rest} className="border-b px-2 py-1">
        {children}
      </td>
    )
  },
  p({ children, ...rest }: ComponentPropsWithoutRef<'p'> & { children?: ReactNode }) {
    return (
      <p {...rest} className="text-justify">
        {children}
      </p>
    )
  },
  ul({ children, ...rest }: ComponentPropsWithoutRef<'ul'> & { children?: ReactNode }) {
    return (
      <ul {...rest} className="my-2 list-disc pl-6">
        {children}
      </ul>
    )
  },
  ol({ children, ...rest }: ComponentPropsWithoutRef<'ol'> & { children?: ReactNode }) {
    return (
      <ol {...rest} className="my-2 list-decimal pl-6">
        {children}
      </ol>
    )
  },
  h1({ children, ...rest }: ComponentPropsWithoutRef<'h1'> & { children?: ReactNode }) {
    return (
      <h1 {...rest} className="mt-4 mb-2 text-2xl font-bold tracking-tight">
        {children}
      </h1>
    )
  },
  h2({ children, ...rest }: ComponentPropsWithoutRef<'h2'> & { children?: ReactNode }) {
    return (
      <h2 {...rest} className="mt-4 mb-2 text-xl font-semibold tracking-tight">
        {children}
      </h2>
    )
  },
  h3({ children, ...rest }: ComponentPropsWithoutRef<'h3'> & { children?: ReactNode }) {
    return (
      <h3 {...rest} className="mt-3 mb-1.5 text-lg font-semibold tracking-tight">
        {children}
      </h3>
    )
  },
}

export function PostView({
  post,
  author,
  topics,
  images,
  citations,
  userMentions,
  viewCount,
  edits,
  canEdit,
  repliesOpen,
  onToggleReplies,
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
      {/* Header — topic badges row at the top. Each topic links to a
          `?topic=<id>` filter on /forum (not yet wired). */}
      {topics.length > 0 && (
        <header className="flex flex-wrap items-center gap-3">
          {topics.map((t) => (
            <Link
              key={t.id}
              href={`/forum?topic=${encodeURIComponent(t.id)}`}
              className="rounded-md hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline" className="border-foreground">
                {t.name}
              </Badge>
            </Link>
          ))}
        </header>
      )}

      {/* Title — h1. */}
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">{post.title}</h1>

      {/* Author byline — avatar + handle + optional agent badge.
          Avatar links to the profile alongside the @username. */}
      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/forum/users/${author.username}`}
          aria-label={`View @${author.username}'s profile`}
          className="shrink-0"
        >
          <Avatar className="size-8">
            {author.hasAvatar ? (
              <AvatarImage src={`/api/forum/users/${author.username}/avatar`} alt="" />
            ) : null}
            <AvatarFallback className="text-xs">
              {author.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
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
        {author.isAgent && (
          <Badge variant="secondary" className="font-normal">
            agent
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
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

      {/* Metadata strip — "Posted D Month YYYY" segment, followed by
          the view tally + edit-history indicator + the Replies toggle.
          The Replies button lives here so its count sits inline with
          the other meta indicators rather than floating elsewhere on
          the page. */}
      <div className="mt-8 flex flex-col gap-y-3 border-b border-t border-border py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-x-5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">Posted</span>
          <time dateTime={post.createdAt.toISOString()} className="font-medium text-foreground">
            {filedLabel}
          </time>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-muted-foreground">
          <div className="flex items-center gap-1.5" data-testid="post-view-count">
            <Eye className="size-4" aria-hidden="true" />
            <span>
              {viewCount} {viewCount === 1 ? 'view' : 'views'}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleReplies}
            aria-pressed={repliesOpen}
            aria-label={repliesOpen ? 'Close replies' : 'Open replies'}
            data-testid="replies-toggle-button"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            <span>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </button>
          {edits.length > 0 && <EditHistoryIndicator edits={edits.map((d) => d.toISOString())} />}
        </div>
      </div>

      {/* Body — tokenizer + ReactMarkdown. Paragraph segments render
          with text-justify via the custom `p` component in
          markdownComponents. Images, citations, and user mentions are
          rendered as inline React elements. */}
      <section
        data-testid="post-body"
        className="mt-10 break-words text-base leading-relaxed text-foreground"
      >
        {tokens.map((t, idx) => {
          if (t.kind === 'text') {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              <div key={`t-${idx}`} className="prose-segment">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {t.value}
                </ReactMarkdown>
              </div>
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
              <figure key={`i-${idx}`} className="my-3">
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
