/**
 * Server-only data + validation helpers for the Settings → Targets panel.
 *
 * Keeps SQL out of the page/route handlers so both the RSC page and the
 * client-facing JSON routes share the same invariants (length caps,
 * required-field checks, prompt-template existence). Pages call these
 * directly; API handlers call them after auth.
 *
 * Cadence: stored as the literal preset string. Phase 4 cron sidecar parses
 * it. We deliberately don't ship a parser here — just an allow-list of the
 * v0.1 presets so we don't accept arbitrary strings from the form yet.
 *
 * `next_due_at` on creation: set to `now()` so a freshly-added target is
 * immediately ready for the cron sidecar (Phase 4) to pick up. Admins who
 * don't want immediate pickup can pause the target.
 *
 * This module imports `@lucidindex/db/client`, which throws at module-load
 * time if `DATABASE_URL` is not set — i.e. it's de facto server-only.
 * Don't import it from a client component.
 */

import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import { promptTemplates, targets } from '@lucidindex/db/schema'

export const CADENCE_PRESETS = ['every 5 minutes', 'hourly', 'every 4 hours', 'daily'] as const
export type CadencePreset = (typeof CADENCE_PRESETS)[number]

export const LABEL_MAX = 200
export const URL_OR_HANDLE_MAX = 500

export type TargetRow = {
  id: string
  label: string
  urlOrHandle: string
  cadence: string
  promptTemplateId: string
  promptTemplateSlug: string | null
  active: boolean
  lastRunStatus: string | null
  lastRunAt: Date | null
  lastRunFailureReason: string | null
  nextDueAt: Date
  createdAt: Date
  updatedAt: Date
}

export type PromptTemplateOption = {
  id: string
  slug: string
}

/** Field-level errors keyed by form field name. */
export type ValidationErrors = Partial<{
  label: string
  urlOrHandle: string
  cadence: string
  promptTemplateId: string
  active: string
  _form: string
}>

export type TargetInput = {
  label: string
  urlOrHandle: string
  cadence: string
  promptTemplateId: string
  active: boolean
}

export type PartialTargetInput = Partial<TargetInput>

/** List every target with its prompt-template slug, newest first. */
export async function listTargets(): Promise<TargetRow[]> {
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      urlOrHandle: targets.urlOrHandle,
      cadence: targets.cadence,
      promptTemplateId: targets.promptTemplateId,
      promptTemplateSlug: promptTemplates.slug,
      active: targets.active,
      lastRunStatus: targets.lastRunStatus,
      lastRunAt: targets.lastRunAt,
      lastRunFailureReason: targets.lastRunFailureReason,
      nextDueAt: targets.nextDueAt,
      createdAt: targets.createdAt,
      updatedAt: targets.updatedAt,
    })
    .from(targets)
    .leftJoin(promptTemplates, eq(targets.promptTemplateId, promptTemplates.id))
    .orderBy(desc(targets.createdAt))
  return rows
}

export async function getTarget(id: string): Promise<TargetRow | null> {
  const rows = await db
    .select({
      id: targets.id,
      label: targets.label,
      urlOrHandle: targets.urlOrHandle,
      cadence: targets.cadence,
      promptTemplateId: targets.promptTemplateId,
      promptTemplateSlug: promptTemplates.slug,
      active: targets.active,
      lastRunStatus: targets.lastRunStatus,
      lastRunAt: targets.lastRunAt,
      lastRunFailureReason: targets.lastRunFailureReason,
      nextDueAt: targets.nextDueAt,
      createdAt: targets.createdAt,
      updatedAt: targets.updatedAt,
    })
    .from(targets)
    .leftJoin(promptTemplates, eq(targets.promptTemplateId, promptTemplates.id))
    .where(eq(targets.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function listPromptTemplateOptions(): Promise<PromptTemplateOption[]> {
  const rows = await db
    .select({ id: promptTemplates.id, slug: promptTemplates.slug })
    .from(promptTemplates)
    .orderBy(promptTemplates.slug)
  return rows
}

export async function hasAnyPromptTemplates(): Promise<boolean> {
  const rows = await db.select({ id: promptTemplates.id }).from(promptTemplates).limit(1)
  return rows.length > 0
}

async function promptTemplateExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(eq(promptTemplates.id, id))
    .limit(1)
  return rows.length > 0
}

function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Coerce a form payload (FormData entries OR JSON) into a TargetInput. */
export function coerceTargetInput(raw: Record<string, unknown>): TargetInput {
  return {
    label: trimOrEmpty(raw.label),
    urlOrHandle: trimOrEmpty(raw.urlOrHandle ?? raw.url_or_handle),
    cadence: trimOrEmpty(raw.cadence),
    promptTemplateId: trimOrEmpty(raw.promptTemplateId ?? raw.prompt_template_id),
    active: raw.active === true || raw.active === 'true' || raw.active === 'on',
  }
}

/**
 * Validate a full TargetInput for create/replace. Returns the error map (empty
 * = valid). Verifies prompt_template_id exists with a DB read so the FK
 * constraint never gets hit at insert time.
 */
export async function validateTargetInput(input: TargetInput): Promise<ValidationErrors> {
  const errors: ValidationErrors = {}

  if (!input.label) errors.label = 'Label is required.'
  else if (input.label.length > LABEL_MAX)
    errors.label = `Label must be ${LABEL_MAX} characters or fewer.`

  if (!input.urlOrHandle) errors.urlOrHandle = 'URL or handle is required.'
  else if (input.urlOrHandle.length > URL_OR_HANDLE_MAX)
    errors.urlOrHandle = `URL or handle must be ${URL_OR_HANDLE_MAX} characters or fewer.`

  if (!input.cadence) {
    errors.cadence = 'Cadence is required.'
  } else if (!CADENCE_PRESETS.includes(input.cadence as CadencePreset)) {
    errors.cadence = `Cadence must be one of: ${CADENCE_PRESETS.join(', ')}.`
  }

  if (!input.promptTemplateId) {
    errors.promptTemplateId = 'Prompt template is required.'
  } else if (!(await promptTemplateExists(input.promptTemplateId))) {
    errors.promptTemplateId = 'Selected prompt template no longer exists.'
  }

  return errors
}

/**
 * Insert a new target. Sets `next_due_at = now()` so the cron sidecar
 * (Phase 4) picks it up immediately; admins who don't want immediate
 * pickup can toggle `active = false` after creation.
 */
export async function createTarget(input: TargetInput): Promise<{ id: string }> {
  const inserted = await db
    .insert(targets)
    .values({
      label: input.label,
      urlOrHandle: input.urlOrHandle,
      cadence: input.cadence,
      promptTemplateId: input.promptTemplateId,
      active: input.active,
      nextDueAt: sql`now()`,
    })
    .returning({ id: targets.id })
  const row = inserted[0]
  if (!row) {
    // `RETURNING` on a single-row insert always yields exactly one row;
    // if it doesn't, the DB is in a state we can't recover from here.
    throw new Error('createTarget: insert did not return a row')
  }
  return { id: row.id }
}

/**
 * Update human-supplied fields on a target. Cron-managed fields
 * (`next_due_at`, `last_run_*`, `high_water_mark`) are NEVER touched here —
 * those belong to the Phase 4 cron sidecar / Phase 3 mcp-store.
 *
 * If the edit transitions `active = false → true` (i.e. resume via the form
 * rather than the dedicated active-toggle endpoint), set
 * `hwm_reset_pending = true` so the cron sidecar clears `high_water_mark` on
 * its next sweep — see #51 / apps/cron/src/jobs/hwm-reset.ts.
 */
export async function updateTarget(id: string, input: TargetInput): Promise<void> {
  const previous = await db
    .select({ active: targets.active })
    .from(targets)
    .where(eq(targets.id, id))
    .limit(1)
  const wasActive = previous[0]?.active === true
  const isResuming = !wasActive && input.active === true

  await db
    .update(targets)
    .set({
      label: input.label,
      urlOrHandle: input.urlOrHandle,
      cadence: input.cadence,
      promptTemplateId: input.promptTemplateId,
      active: input.active,
      updatedAt: sql`now()`,
      ...(isResuming ? { hwmResetPending: true } : {}),
    })
    .where(eq(targets.id, id))
}

/**
 * Pause/resume a target by flipping `active`.
 *
 * Transitioning `active = false → true` (i.e. unpause/resume) sets
 * `hwm_reset_pending = true` so the cron sidecar's `hwm_reset` job clears
 * `high_water_mark` on its next sweep — see Round 6 in
 * apps/cron/src/jobs/hwm-reset.ts and Project-LucidIndex #51. We only flip
 * the flag when the previous state was `active = false`; resuming an
 * already-active target is a no-op for the flag.
 *
 * Pausing (`active = true → false`) leaves `hwm_reset_pending` alone —
 * agents stop running, but the saved high-water-mark stays put in case the
 * pause is brief. The hard-reset only fires on the next unpause.
 */
export async function setTargetActive(id: string, active: boolean): Promise<void> {
  // Read the previous `active` state inside the same logical operation so
  // we can detect the false → true transition. There's a small TOCTOU
  // window (a parallel toggle could race), but the column is a simple
  // boolean — at worst we set hwm_reset_pending once redundantly, which
  // the next cron sweep will consume idempotently.
  const previous = await db
    .select({ active: targets.active })
    .from(targets)
    .where(eq(targets.id, id))
    .limit(1)
  const wasActive = previous[0]?.active === true
  const isResuming = !wasActive && active === true

  await db
    .update(targets)
    .set({
      active,
      updatedAt: sql`now()`,
      ...(isResuming ? { hwmResetPending: true } : {}),
    })
    .where(eq(targets.id, id))
}
