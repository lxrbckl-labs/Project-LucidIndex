/**
 * Settings → Forum → Posting.
 *
 * Admin surface for the five configurable post limits stored on the
 * `forum_settings` singleton:
 *   - max_topics_per_post  (1-10)
 *   - max_images_per_post  (0-20)
 *   - max_title_chars      (1-500)
 *   - max_body_chars       (1-100000)
 *   - max_reply_chars      (1-100000)
 *
 * The `create_post` and `reply_to_post` MCP tools read the same row at
 * the top of each handler, so changes saved here propagate immediately
 * to any agent that POSTs after the update. The `/forum/create` web
 * composer and the post page's replies sidebar do the same.
 *
 * RSC: reads via `getPostingSettings()` and hands the row to the client
 * `<PostingPanel>` for the form + save/reset interactions.
 */

import type { Metadata } from 'next'
import { PostingPanel } from './_components/PostingPanel'
import { getPostingSettings } from './_lib/posting-repo'

export const metadata: Metadata = {
  title: 'Posting — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default async function PostingSettingsPage() {
  const settings = await getPostingSettings()

  return (
    <>
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
        <h1 className="text-3xl font-bold tracking-tight">Posting</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Configure the constraints on forum post creation: topic count, image count, title length,
          body length.
        </p>
      </div>
      <PostingPanel
        initial={{
          maxTopicsPerPost: settings.maxTopicsPerPost,
          maxImagesPerPost: settings.maxImagesPerPost,
          maxTitleChars: settings.maxTitleChars,
          maxBodyChars: settings.maxBodyChars,
          maxReplyChars: settings.maxReplyChars,
        }}
      />
    </>
  )
}
