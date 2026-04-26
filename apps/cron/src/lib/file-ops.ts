// File-system helpers for the cron sidecar.
//
// Phase 7 (#72/#75) — disk operations performed by retention-purge and
// local-backup. Centralized here so the missing-file-OK semantics are
// consistent and easy to reason about.
//
// HARD RULE on deletions: Project-Sardaukar's "NO DELETIONS" rule applies to
// agent actions on behalf of human work (issues, PRs, repos, branches). The
// retention-purge cron job deletes article rows + hero image files as a
// designed system behavior per the v0.1 spec. Local backup pruning removes
// backup files older than the configured retention. Both are documented,
// scheduled, and bounded by the spec — they are NOT "the agent decided to
// delete things on its own."

import { stat, unlink } from 'node:fs/promises'
import { logger } from '../logger.js'

/**
 * Delete a file. If the file does not exist, return `{ deleted: false,
 * reason: 'enoent' }` instead of throwing — the caller (retention-purge,
 * backup retention) treats a missing file as "already gone, nothing to do".
 *
 * Any OTHER error (permission denied, I/O error, EISDIR) is caught and
 * surfaced as `{ deleted: false, reason: <message> }` so the caller can
 * count failures without crashing the cron tick. We deliberately do NOT
 * re-throw: a single un-deletable file should never block the rest of the
 * sweep (e.g. one orphaned hero image must not block the DB delete of the
 * matching article row).
 */
export async function deleteFileIfExists(
  path: string,
): Promise<{ deleted: boolean; reason?: string }> {
  try {
    await unlink(path)
    return { deleted: true }
  } catch (err) {
    // Node's fs error has a `code` property.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      // Missing file is graceful — already gone.
      return { deleted: false, reason: 'enoent' }
    }
    const reason = err instanceof Error ? err.message : String(err)
    // Log the unusual failure so an operator can investigate, but don't throw.
    logger.warn('file_delete_failed', { path, reason })
    return { deleted: false, reason }
  }
}

/**
 * Get a file's size in bytes. Returns null if the file is missing or stat
 * fails for any reason — callers report 0 / unknown rather than crashing.
 */
export async function fileSizeBytesOrNull(path: string): Promise<number | null> {
  try {
    const s = await stat(path)
    return s.size
  } catch {
    return null
  }
}
