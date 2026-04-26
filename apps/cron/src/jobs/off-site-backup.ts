// #76 — Off-site backup.
//
// Schedule: nightly at 02:30 (cron expression `30 2 * * *`).
//
// Runs 30 minutes AFTER the local backup (#75 at 02:00) so the freshest
// .dump and image archive are on disk when this job kicks off. The two
// jobs are NOT chained programmatically — they are independent cron
// entries timed sequentially. If local-backup runs long, off-site-backup
// just picks up the previous night's files (or no files at all on a
// brand-new install) and reports accordingly.
//
// Behavior:
//   1. Read settings.off_site_backup_remote +
//      settings.off_site_backup_credentials_encrypted from the singleton
//      settings row. If either is unset, status = succeeded with details
//      `{ skipped: true, reason: '...' }`. We do NOT fail the job for an
//      unconfigured remote — that's a normal install state.
//   2. Decrypt the credentials blob using IRON_SESSION_PASSWORD (same
//      key derivation as apps/web; see lib/decrypt-credentials.ts).
//   3. Find the most recent local backup files in BACKUP_DIR (the .dump
//      and the images-*.tar that #75 wrote tonight; or the most recent
//      ones available).
//   4. Write the decrypted rclone config to a tmp file (mode 0600), invoke
//      `rclone copy <file> <remote>:<path> --config <tmpfile>` for each
//      backup file. Delete the tmp file on the way out (try/finally).
//   5. Write the cron_runs row with details `{ remote, files_shipped,
//      files_failed, size_bytes }`.
//
// ENCRYPTION-AT-REST: the admin's rclone config (which itself can use
// rclone's `crypt` backend, S3 server-side encryption, etc.) is opaque to
// us. We treat it as a config blob; what it does on the wire / at the
// remote is the admin's call. v0.1 ships with this minimal contract.
//
// FAILURE MODES:
//   - rclone not installed → spawn rejects → cron_run goes to status
//     'failed' with the spawn error. Local backup remains intact.
//   - decryption fails (rotated IRON_SESSION_PASSWORD, tampered bytea) →
//     auth-tag throw bubbles to runJob → cron_run 'failed', no log of
//     the ciphertext or the password.
//   - rclone copy fails per-file → counted, recorded, job continues with
//     the next file. The cron_run is 'succeeded' with files_failed > 0
//     so the dashboard can graph partial-shipment nights.
//   - DB read fails → bubbles up, cron_run 'failed'.
//
// HARD RULE: never log credentials. The decrypted rclone config is held
// in memory only long enough to write the temp file, and never appears in
// logs (we log paths and counts, not contents).

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { settings } from '@lucidindex/db/schema'
import env from '../env.js'
import { decryptOffSiteCredentials } from '../lib/decrypt-credentials.js'
import { fileSizeBytesOrNull } from '../lib/file-ops.js'
import { type JobDetails, runJob } from '../lib/run-job.js'
import { logger } from '../logger.js'

/**
 * Spawn a child process and resolve when it exits. Captures stderr (4 KB
 * cap) for inclusion in the rejection message on non-zero exit. Mirrors
 * the helper in local-backup.ts but kept duplicated to keep each job
 * self-contained — if we add a third spawning job we'll factor it out.
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

/**
 * List backup files in the configured BACKUP_DIR that we want to ship.
 * Returns the most recent .dump and the most recent images-*.tar.
 */
async function findLatestBackupFiles(
  backupDir: string,
): Promise<Array<{ name: string; path: string; size: number }>> {
  let entries: string[]
  try {
    entries = await readdir(backupDir)
  } catch {
    return []
  }

  const dumps: Array<{ name: string; mtime: number }> = []
  const archives: Array<{ name: string; mtime: number }> = []
  for (const entry of entries) {
    const full = join(backupDir, entry)
    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(full)
    } catch {
      continue
    }
    if (!s.isFile()) continue
    if (entry.startsWith('lucidindex-') && entry.endsWith('.dump')) {
      dumps.push({ name: entry, mtime: s.mtimeMs })
    } else if (entry.startsWith('images-') && entry.endsWith('.tar')) {
      archives.push({ name: entry, mtime: s.mtimeMs })
    }
  }

  const latest: Array<{ name: string; mtime: number }> = []
  // Sort newest-first; we ship one .dump (the freshest) and one images-*.tar
  // (the freshest). Multiple older snapshots stay on disk for retention but
  // are not re-shipped.
  dumps.sort((a, b) => b.mtime - a.mtime)
  archives.sort((a, b) => b.mtime - a.mtime)
  const newestDump = dumps[0]
  if (newestDump) latest.push(newestDump)
  const newestArchive = archives[0]
  if (newestArchive) latest.push(newestArchive)

  const out: Array<{ name: string; path: string; size: number }> = []
  for (const f of latest) {
    const path = join(backupDir, f.name)
    const size = (await fileSizeBytesOrNull(path)) ?? 0
    out.push({ name: f.name, path, size })
  }
  return out
}

export async function runOffSiteBackup(): Promise<void> {
  await runJob('off_site_backup', async (): Promise<JobDetails> => {
    // 1. Read settings.
    const rows = await db
      .select({
        offSiteBackupRemote: settings.offSiteBackupRemote,
        offSiteBackupCredentialsEncrypted: settings.offSiteBackupCredentialsEncrypted,
      })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1)

    const row = rows[0]
    const remoteName = row?.offSiteBackupRemote ?? null
    const credsEncrypted = row?.offSiteBackupCredentialsEncrypted ?? null

    if (!remoteName || !credsEncrypted) {
      logger.info('off_site_backup_skipped_unconfigured')
      return { skipped: true, reason: 'not configured' }
    }

    // 2. Decrypt — requires IRON_SESSION_PASSWORD.
    if (!env.IRON_SESSION_PASSWORD) {
      // Treat as configured-but-broken: skip + record reason. The admin
      // needs to set the env var (matching the apps/web one) before this
      // can ship anything. We choose 'skipped' over 'failed' so the
      // dashboard distinguishes "remote unreachable" from "config gap".
      logger.warn('off_site_backup_skipped_no_password')
      return { skipped: true, reason: 'IRON_SESSION_PASSWORD not set' }
    }
    const credsPlaintext = decryptOffSiteCredentials(credsEncrypted, env.IRON_SESSION_PASSWORD)
    if (!credsPlaintext) {
      // Malformed payload (too short). Surface the reason without leaking
      // the bytes themselves.
      logger.warn('off_site_backup_decrypt_returned_null')
      return { skipped: true, reason: 'credentials payload malformed' }
    }

    // 3. Find latest backup files.
    const backupDir = resolve(env.BACKUP_DIR)
    const filesToShip = await findLatestBackupFiles(backupDir)
    if (filesToShip.length === 0) {
      logger.info('off_site_backup_no_files_to_ship', { backup_dir: backupDir })
      return {
        remote: remoteName,
        files_shipped: 0,
        files_failed: 0,
        size_bytes: 0,
        reason: 'no local backup files found',
      }
    }

    // 4. Write the rclone config to a private tmp dir, then ship each
    //    file. mkdtemp gives us a unique dir per tick; mode 0700 by
    //    default on most platforms. The config file itself is written
    //    with mode 0600 (owner read/write only) so even a co-tenant with
    //    read of the parent dir cannot read its bytes.
    const tmpDir = await mkdtemp(join(tmpdir(), 'lucidindex-rclone-'))
    const configPath = join(tmpDir, 'rclone.conf')

    let filesShipped = 0
    let filesFailed = 0
    let sizeBytesShipped = 0
    const failures: string[] = []

    try {
      await writeFile(configPath, credsPlaintext, { mode: 0o600 })

      for (const file of filesToShip) {
        try {
          // `rclone copy <src> <remote>:` — the destination path is the
          // root of the remote; the admin's rclone config decides what
          // backend (s3, b2, sftp, crypt-wrapper, etc.) is used.
          //
          // We do NOT use --progress; we want clean exit-code semantics
          // and minimal stderr noise. --quiet suppresses the per-file
          // info lines but keeps errors.
          await spawnExpectZero('rclone', [
            'copy',
            '--config',
            configPath,
            '--quiet',
            file.path,
            `${remoteName}:`,
          ])
          filesShipped += 1
          sizeBytesShipped += file.size
          logger.info('off_site_backup_file_shipped', {
            file: file.name,
            size_bytes: file.size,
          })
        } catch (err) {
          // Per-file failure: count, record, continue. The cron_run is
          // still 'succeeded' (envelope-wise) with files_failed > 0 —
          // partial shipments are visible on the dashboard rather than
          // hiding behind a 'failed' status that clobbers details.
          const reason = err instanceof Error ? err.message : String(err)
          filesFailed += 1
          if (failures.length < 5) {
            failures.push(`${file.name}: ${reason}`)
          }
          logger.error('off_site_backup_file_failed', { file: file.name, reason })
        }
      }
    } finally {
      // Always clean up the tmp dir + config (even on a thrown error
      // higher up). rm with force+recursive is safe here — we own the dir.
      await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        logger.warn('off_site_backup_tmp_cleanup_failed', {
          reason: err instanceof Error ? err.message : String(err),
        })
      })
    }

    return {
      remote: remoteName,
      files_shipped: filesShipped,
      files_failed: filesFailed,
      size_bytes: sizeBytesShipped,
      ...(failures.length > 0 ? { errors: failures } : {}),
    }
  })
}
