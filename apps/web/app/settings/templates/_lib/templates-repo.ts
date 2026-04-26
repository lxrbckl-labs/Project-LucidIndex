/**
 * Server-only data + validation helpers for the Settings → Templates panel.
 *
 * Mirrors the shape of `targets/_lib/targets-repo.ts` so the two settings
 * panels stay structurally similar — the page/route handlers stay thin and
 * both the RSC page and the API routes share the same invariants.
 *
 * Liquid validation lives in `@lucidindex/templates`; we only call it here.
 * mcp-store (Phase 3) and the cron sidecar (Phase 4) will use the same
 * helper at render time.
 *
 * This module imports `@lucidindex/db/client`, which throws at module-load
 * time if `DATABASE_URL` is not set — i.e. it's de facto server-only.
 * Don't import it from a client component.
 */

import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import { promptTemplates } from '@lucidindex/db/schema'
import { validateLiquidSyntax } from '@lucidindex/templates'

export const SLUG_MAX = 80
export const BODY_MAX = 20_000
export const CROSS_SOURCE_N_MIN = 0
export const CROSS_SOURCE_N_MAX = 20

/** Slugs are lowercase letters / digits / underscore / hyphen. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export type TemplateRow = {
  id: string
  slug: string
  body: string
  crossSourceN: number
  createdAt: Date
  updatedAt: Date
}

export type ValidationErrors = Partial<{
  slug: string
  body: string
  crossSourceN: string
  _form: string
}>

export type TemplateInput = {
  slug: string
  body: string
  crossSourceN: number
}

/** List every template, newest-updated first. */
export async function listTemplates(): Promise<TemplateRow[]> {
  const rows = await db
    .select({
      id: promptTemplates.id,
      slug: promptTemplates.slug,
      body: promptTemplates.body,
      crossSourceN: promptTemplates.crossSourceN,
      createdAt: promptTemplates.createdAt,
      updatedAt: promptTemplates.updatedAt,
    })
    .from(promptTemplates)
    .orderBy(desc(promptTemplates.updatedAt))
  return rows
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  const rows = await db
    .select({
      id: promptTemplates.id,
      slug: promptTemplates.slug,
      body: promptTemplates.body,
      crossSourceN: promptTemplates.crossSourceN,
      createdAt: promptTemplates.createdAt,
      updatedAt: promptTemplates.updatedAt,
    })
    .from(promptTemplates)
    .where(eq(promptTemplates.id, id))
    .limit(1)
  return rows[0] ?? null
}

async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(eq(promptTemplates.slug, slug))
    .limit(1)
  const hit = rows[0]
  if (!hit) return false
  if (exceptId && hit.id === exceptId) return false
  return true
}

function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Coerce a form payload (FormData entries OR JSON) into a TemplateInput. */
export function coerceTemplateInput(raw: Record<string, unknown>): TemplateInput {
  const slugRaw = trimOrEmpty(raw.slug)
  const body = typeof raw.body === 'string' ? raw.body : ''
  // Don't `.trim()` the body — leading/trailing newlines in a Liquid
  // template are sometimes meaningful for the rendered output. Only
  // length-cap it.

  let crossSourceN = 3
  const csnRaw = raw.crossSourceN ?? raw.cross_source_n
  if (typeof csnRaw === 'number' && Number.isFinite(csnRaw)) {
    crossSourceN = Math.trunc(csnRaw)
  } else if (typeof csnRaw === 'string' && csnRaw.trim() !== '') {
    const parsed = Number.parseInt(csnRaw, 10)
    if (Number.isFinite(parsed)) crossSourceN = parsed
  }

  return {
    slug: slugRaw.toLowerCase(),
    body,
    crossSourceN,
  }
}

/**
 * Validate a TemplateInput for create/replace. Returns the error map (empty
 * = valid). Verifies slug uniqueness via a DB read so the unique-index
 * constraint never gets hit at insert time. `exceptId` lets the edit form
 * keep its own slug.
 */
export async function validateTemplateInput(
  input: TemplateInput,
  exceptId?: string,
): Promise<ValidationErrors> {
  const errors: ValidationErrors = {}

  if (!input.slug) {
    errors.slug = 'Slug is required.'
  } else if (input.slug.length > SLUG_MAX) {
    errors.slug = `Slug must be ${SLUG_MAX} characters or fewer.`
  } else if (!SLUG_PATTERN.test(input.slug)) {
    errors.slug =
      'Slug must be lowercase letters, digits, underscore, or hyphen — and cannot start with a separator.'
  } else if (await slugTaken(input.slug, exceptId)) {
    errors.slug = 'Slug is already taken.'
  }

  if (!input.body) {
    errors.body = 'Body is required.'
  } else if (input.body.length > BODY_MAX) {
    errors.body = `Body must be ${BODY_MAX} characters or fewer.`
  } else {
    const liquidError = validateLiquidSyntax(input.body)
    if (liquidError) {
      errors.body = `Liquid syntax error: ${liquidError}`
    }
  }

  if (
    !Number.isFinite(input.crossSourceN) ||
    !Number.isInteger(input.crossSourceN) ||
    input.crossSourceN < CROSS_SOURCE_N_MIN ||
    input.crossSourceN > CROSS_SOURCE_N_MAX
  ) {
    errors.crossSourceN = `Cross-source N must be an integer between ${CROSS_SOURCE_N_MIN} and ${CROSS_SOURCE_N_MAX}.`
  }

  return errors
}

export async function createTemplate(input: TemplateInput): Promise<{ id: string }> {
  const inserted = await db
    .insert(promptTemplates)
    .values({
      slug: input.slug,
      body: input.body,
      crossSourceN: input.crossSourceN,
    })
    .returning({ id: promptTemplates.id })
  const row = inserted[0]
  if (!row) {
    // `RETURNING` on a single-row insert always yields exactly one row;
    // if it doesn't, the DB is in a state we can't recover from here.
    throw new Error('createTemplate: insert did not return a row')
  }
  return { id: row.id }
}

export async function updateTemplate(id: string, input: TemplateInput): Promise<void> {
  await db
    .update(promptTemplates)
    .set({
      slug: input.slug,
      body: input.body,
      crossSourceN: input.crossSourceN,
      updatedAt: sql`now()`,
    })
    .where(eq(promptTemplates.id, id))
}
