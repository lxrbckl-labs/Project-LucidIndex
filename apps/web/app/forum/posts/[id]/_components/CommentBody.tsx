/**
 * CommentBody — renders a single comment's body with `@PostN` citation
 * tokens, `@<username>` user-mention tokens, and `@ImageN` parent-post
 * image references swapped for inline links / inline figures.
 *
 * Mirrors the post-view body tokenizer (`PostView.parseBody`). Image
 * references resolve against the parent post's `forum_post_images` set —
 * replies don't upload their own images, they piggyback on the post's
 * existing set. There's no schema, no API change, no new join table: the
 * comment body just carries the text token and the renderer resolves it
 * against `postImages` passed down from the page-level RSC.
 *
 * Unknown tokens (a `@Post5` whose citation never landed, a `@Image9`
 * whose parent post never had 9 images, a `@someuser` whose row isn't in
 * the mention array) fall through as muted raw text — same posture as
 * the post body renderer, so authors can see what's broken without losing
 * data.
 *
 * The component is client-rendered because it embeds `<InlineCitationLink>`
 * (which uses HoverCard + Popover internally). Plain text runs themselves
 * could be server-rendered but the citation links can't, so the whole
 * component crosses the client boundary.
 */

'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AuthorHoverCard } from '@/components/forum/AuthorHoverCard'
import { InlineCitationLink } from './InlineCitationLink'
import { markdownComponents } from './markdown-config'
import type { PostViewCitation, PostViewUserMention } from './PostView'

export type CommentCitation = PostViewCitation
export type CommentUserMention = PostViewUserMention

/**
 * Tokenizer regex — same shape as `PostView.TOKEN_RE`. Replies don't
 * have their own image uploads, but they CAN reference the parent
 * post's `@ImageN` set (resolved at render time off the parent post's
 * `forum_post_images` rows — see `postImages` prop below). The capture
 * group is included in the split result by design (regex with a
 * capturing group interleaves captures with non-matching text —
 * exactly the alternation we want).
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
 * Lightweight `forum_post_images` row shape. Mirrors `PostViewImage`
 * structurally — we don't re-export from `PostView` to keep the
 * dependency direction one-way (PostView -> CommentBody is fine; the
 * reverse would create a cycle through the import graph).
 */
export type CommentBodyPostImage = {
  imageHash: string
  sequenceNumber: number
  mime: string
}

type Props = {
  body: string
  citations: CommentCitation[]
  userMentions: CommentUserMention[]
  /**
   * Image set from the PARENT POST. Replies don't upload their own
   * images — they piggyback on the post's existing set. Required so
   * `@ImageN` tokens in a comment body resolve against the same indices
   * the post's gallery / inline figures use. An empty array is fine —
   * every `@ImageN` token will fall through to muted raw text.
   */
  postImages: CommentBodyPostImage[]
}

export function CommentBody({ body, citations, userMentions, postImages }: Props) {
  const citationBySeq = new Map<number, CommentCitation>()
  for (const c of citations) citationBySeq.set(c.sequenceNumber, c)
  const mentionByUsername = new Map<string, CommentUserMention>()
  for (const m of userMentions) mentionByUsername.set(m.mentionedUsername.toLowerCase(), m)
  const imageBySeq = new Map<number, CommentBodyPostImage>()
  for (const img of postImages) imageBySeq.set(img.sequenceNumber, img)

  const tokens = parseBody(body)

  // Root element is a `<div>` (not `<p>`) because inline `@ImageN`
  // tokens render as `<figure>` — a block element. Putting block
  // elements inside `<p>` is invalid HTML and triggers React hydration
  // mismatches. `whitespace-pre-wrap` on the wrapper preserves the
  // composer's line breaks the same way the old `<p>` did.
  return (
    <div className="whitespace-pre-wrap break-words pl-10 text-sm leading-relaxed text-foreground">
      {tokens.map((t, idx) => {
        if (t.kind === 'text') {
          // Render the plain-text runs as markdown so replies get the same
          // **bold** / *italic* / `code` / list / link formatting as the post
          // body. `disallowedElements={['p']} unwrapDisallowed` keeps the text
          // inline within the pre-wrap wrapper (no injected paragraph blocks),
          // mirroring PostView's body renderer and preserving the composer's
          // own line breaks. Shares the exact component map via markdown-config.
          return (
            <ReactMarkdown
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              key={`t-${idx}`}
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
              disallowedElements={['p']}
              unwrapDisallowed
            >
              {t.value}
            </ReactMarkdown>
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
            <figure
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed token sequence is stable across renders
              key={`i-${idx}`}
              className="my-2"
              data-testid={`comment-image-inline-${img.sequenceNumber}`}
            >
              {/* biome-ignore lint/performance/noImgElement: bytes served by /i/<hash> route handler */}
              <img
                src={`/i/${img.imageHash}`}
                alt={`Inline reference @Image${img.sequenceNumber}`}
                draggable={false}
                className="max-w-full rounded-md border bg-muted select-none"
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
              data-testid={`comment-mention-inline-${mention.mentionedUsername}`}
            >
              @{mention.mentionedUsername}
            </a>
          </AuthorHoverCard>
        )
      })}
    </div>
  )
}
