// `list_targets` — return all targets for cross-reference.
//
// Read-only. Lets agents check whether an author they've encountered is
// already on file (under any label/handle) before writing a redundant
// description or social URL. Each row carries presence flags, not the
// raw text, so the corpus stays compact and the agent can branch on
// "is this gap worth filling?" without paging through bodies.
//
// Hidden / paused targets are still listed — agents may need to know
// about them to avoid creating accidental duplicates.

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { asc } from 'drizzle-orm'

export type TargetSummary = {
  id: string
  label: string
  url_or_handle: string
  has_description: boolean
  has_social_url: boolean
  has_photo_url: boolean
}

export async function listTargets(): Promise<{ targets: TargetSummary[] }> {
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      urlOrHandle: targets.urlOrHandle,
      description: targets.description,
      socialUrl: targets.socialUrl,
      photoUrl: targets.photoUrl,
    })
    .from(targets)
    .orderBy(asc(targets.label))

  return {
    targets: rows.map((r) => ({
      id: r.id,
      label: r.label,
      url_or_handle: r.urlOrHandle,
      has_description: r.description !== null,
      has_social_url: r.socialUrl !== null,
      has_photo_url: r.photoUrl !== null,
    })),
  }
}
