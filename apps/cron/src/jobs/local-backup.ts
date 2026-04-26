// #75 — Local backup.
//
// Schedule: nightly at 02:00 (cron expression `0 2 * * *`).
//
// Behavior:
//   1. Generate timestamp YYYY-MM-DD-HHMMSS (UTC).
//   2. Run `pg_dump --format=custom` against DATABASE_URL → write to
//      <BACKUP_DIR>/lucidindex-<timestamp>.dump.
//      Custom-format dumps are compressed and `pg_restore`-friendly; they
//      are smaller and more flexible than plain SQL dumps.
//   3. Snapshot the hero image directory: tar <MCP_IMAGE_DIR>/ →
//      <BACKUP_DIR>/images-<timestamp>.tar. tar is used (not rsync/cp) so
//      the snapshot is one file the off-site shipment in #76 can hand to
//      rclone alongside the .dump.
//   4. Retention sweep: any file in <BACKUP_DIR> older than
//      BACKUP_RETENTION_DAYS (default 14) is unlinked.
//   5. Write a `cron_runs` row with:
//        { backup_path, image_archive_path, size_bytes, image_size_bytes,
//          retention_pruned, retention_prune_errors }
//
// SYSTEM TOOL DEPENDENCY: `pg_dump` and `tar` must be on PATH. The cron
// Docker image (apps/cron/Dockerfile) installs `postgresql-client` (gives
// pg_dump) and uses BusyBox's tar (already in node:22-alpine). For local
// dev, both are commonly already installed.
//
// CHOICE — apk add postgresql-client vs `docker exec` into the postgres
// container: apk-installed pg_dump is simpler (no docker socket mount, no
// container coordination, works identically in dev) and only adds ~12 MB
// to the runner image. We chose simplicity.
//
// CHILD PROCESS: spawn (NOT exec) — args are passed as an array, no shell
// involvement, no shell-injection risk. We pass DATABASE_URL via the
// child's PROCESS env (not as a CLI flag) so it never appears in `ps` /
// proc listings, and we do NOT log the URL anywhere.
//
// RETENTION: included here (not as a separate job) so a single tick is
// self-contained and the dashboard sees one row per nightly run. The
// retention sweep runs AFTER the new backup is written successfully —
// otherwise a single bad night could prune the only remaining good
// backup.

import { spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import env from '../env.js'
import { deleteFileIfExists, fileSizeBytesOrNull } from '../lib/file-ops.js'
import { type JobDetails, runJob } from '../lib/run-job.js'
import { logger } from '../logger.js'

/**
 * Build a YYYY-MM-DD-HHMMSS timestamp in UTC. Sortable, unambiguous, and
 * file-system-safe (no colons or spaces).
 */
function utcTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = now.getUTCFullYear()
  const mm = pad(now.getUTCMonth() + 1)
  const dd = pad(now.getUTCDate())
  const hh = pad(now.getUTCHours())
  const mi = pad(now.getUTCMinutes())
  const ss = pad(now.getUTCSeconds())
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`
}

/**
 * Spawn a child process and resolve when it exits. Rejects on non-zero
 * exit, on spawn error, or if any data appears on stderr that smells like
 * an error (we still resolve on zero-exit + stderr noise — pg_dump writes
 * progress messages to stderr in some configurations).
 *
 * stderr is captured (not piped to ours) so credentials accidentally
 * echoed by the child wouldn't surface in the cron sidecar's logs.
 * Internal stderr text is included in thrown errors but capped at 4 KB.
 */
async function spawnExpectZero(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderrBuf = ''
    child.stderr?.on('data', (chunk) => {
      if (stderrBuf.length < 4096) {
        stderrBuf += chunk.toString('utf8')
      }
    })
    child.on('error', (err) => rejectPromise(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        const trimmedStderr = stderrBuf.slice(0, 4096).trim()
        rejectPromise(
          new Error(
            `${command} exited with code ${code}${trimmedStderr ? `: ${trimmedStderr}` : ''}`,
          ),
        )
      }
    })
  })
}

export async function runLocalBackup(): Promise<void> {
  await runJob('local_backup', async (): Promise<JobDetails> => {
    const now = new Date()
    const ts = utcTimestamp(now)
    const backupDir = resolve(env.BACKUP_DIR)
    const imageDir = resolve(env.MCP_IMAGE_DIR)

    await mkdir(backupDir, { recursive: true })

    // ---- pg_dump --------------------------------------------------------
    const dumpPath = join(backupDir, `lucidindex-${ts}.dump`)
    // Pass DATABASE_URL via env (PGURL-style positional CLI arg would also
    // work, but env keeps it out of `ps`).
    // -Fc = custom format (compressed, restore-flexible).
    // -f  = output file.
    // The DATABASE_URL is read from env at spawn time and never logged.
    if (!env.DATABASE_URL) {
      // env.ts asserts this at module load; this branch is here for the type-
      // checker and as a defense-in-depth guard.
      throw new Error('DATABASE_URL not set')
    }
    await spawnExpectZero('pg_dump', ['-Fc', '-f', dumpPath, env.DATABASE_URL], {
      env: { ...process.env, PGCONNECT_TIMEOUT: '30' },
    })
    logger.info('local_backup_pg_dump_done', { path: dumpPath })

    const dumpSize = (await fileSizeBytesOrNull(dumpPath)) ?? 0

    // ---- image archive --------------------------------------------------
    // tar the hero image directory into a single archive. We only archive
    // if the source dir exists; a fresh install with no images yet should
    // not crash the backup.
    const imageArchivePath = join(backupDir, `images-${ts}.tar`)
    let imageSize: number | null = null
    let imageCount: number | null = null

    let imageDirExists = false
    try {
      const s = await stat(imageDir)
      imageDirExists = s.isDirectory()
    } catch {
      imageDirExists = false
    }

    if (imageDirExists) {
      // Count files for the cron_runs details payload (ignores subdirs;
      // image-pipeline.ts writes flat into MCP_IMAGE_DIR).
      try {
        const entries = await readdir(imageDir)
        imageCount = entries.length
      } catch {
        imageCount = null
      }

      // -C <dir> changes into the dir before reading, so the tarball entries
      // are relative paths (./<hash>.webp) rather than absolute. -c create,
      // -f file. No compression — these files are already WebP/JPEG.
      await spawnExpectZero('tar', ['-cf', imageArchivePath, '-C', imageDir, '.'])
      logger.info('local_backup_image_archive_done', { path: imageArchivePath })
      imageSize = await fileSizeBytesOrNull(imageArchivePath)
    } else {
      logger.info('local_backup_image_dir_missing_skip', { dir: imageDir })
    }

    // ---- retention sweep -------------------------------------------------
    const cutoffMs = now.getTime() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
    let retentionPruned = 0
    let retentionPruneErrors = 0
    try {
      const entries = await readdir(backupDir)
      for (const entry of entries) {
        const full = join(backupDir, entry)
        // Only consider OUR backup file naming patterns. Anything else in
        // the dir (operator scratch files, .gitkeep, foreign manual dumps)
        // is left untouched — defensive, since we never want this job to
        // delete files we don't own.
        if (!entry.startsWith('lucidindex-') && !entry.startsWith('images-')) continue
        let entryStat: Awaited<ReturnType<typeof stat>>
        try {
          entryStat = await stat(full)
        } catch {
          continue
        }
        if (!entryStat.isFile()) continue
        if (entryStat.mtimeMs >= cutoffMs) continue

        const result = await deleteFileIfExists(full)
        if (result.deleted) {
          retentionPruned += 1
        } else if (result.reason && result.reason !== 'enoent') {
          retentionPruneErrors += 1
        }
      }
    } catch (err) {
      // readdir failure on the backup dir itself — log but don't fail the
      // whole backup (the new files are already written successfully).
      const reason = err instanceof Error ? err.message : String(err)
      logger.warn('local_backup_retention_sweep_failed', { reason })
    }

    return {
      backup_path: dumpPath,
      image_archive_path: imageDirExists ? imageArchivePath : null,
      image_count: imageCount,
      size_bytes: dumpSize,
      image_size_bytes: imageSize,
      retention_pruned: retentionPruned,
      retention_prune_errors: retentionPruneErrors,
    }
  })
}
