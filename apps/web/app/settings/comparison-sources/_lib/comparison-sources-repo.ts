/**
 * Server-only data + validation helpers for Settings → Comparison Sources.
 *
 * Mirrors the pattern in `targets-repo.ts`. Keeps SQL out of route
 * handlers and RSC pages so they stay thin and independently testable.
 *
 * "Delete" is a soft-delete: sets `is_active = false`. The row is
 * preserved so existing `articles.citations` entries that reference the
 * source name remain coherent.
 */

import { db } from '@lucidindex/db/client'
import { asc, eq, sql } from '@lucidindex/db/query'
import { comparisonSources } from '@lucidindex/db/schema'

export const NAME_MAX = 200
export const BASE_URL_MAX = 500
export const NOTES_MAX = 2000

export type ComparisonSourceRow = {
  id: string
  name: string
  baseUrl: string
  isActive: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

/** Field-level validation errors keyed by form field. */
export type ComparisonSourceValidationErrors = Partial<{
  name: string
  baseUrl: string
  notes: string
  _form: string
}>

export type ComparisonSourceInput = {
  name: string
  baseUrl: string
  isActive: boolean
  notes: string | null
}

/** List every comparison source (active + inactive), alphabetical. */
export async function listComparisonSources(): Promise<ComparisonSourceRow[]> {
  return db
    .select({
      id: comparisonSources.id,
      name: comparisonSources.name,
      baseUrl: comparisonSources.baseUrl,
      isActive: comparisonSources.isActive,
      notes: comparisonSources.notes,
      createdAt: comparisonSources.createdAt,
      updatedAt: comparisonSources.updatedAt,
    })
    .from(comparisonSources)
    .orderBy(asc(comparisonSources.name))
}

export async function getComparisonSource(id: string): Promise<ComparisonSourceRow | null> {
  const rows = await db
    .select({
      id: comparisonSources.id,
      name: comparisonSources.name,
      baseUrl: comparisonSources.baseUrl,
      isActive: comparisonSources.isActive,
      notes: comparisonSources.notes,
      createdAt: comparisonSources.createdAt,
      updatedAt: comparisonSources.updatedAt,
    })
    .from(comparisonSources)
    .where(eq(comparisonSources.id, id))
    .limit(1)
  return rows[0] ?? null
}

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function coerceComparisonSourceInput(raw: Record<string, unknown>): ComparisonSourceInput {
  const notes = trim(raw.notes)
  return {
    name: trim(raw.name),
    baseUrl: trim(raw.baseUrl ?? raw.base_url),
    isActive: raw.isActive === true || raw.isActive === 'true' || raw.isActive === 'on',
    notes: notes || null,
  }
}

export function validateComparisonSourceInput(
  input: ComparisonSourceInput,
): ComparisonSourceValidationErrors {
  const errors: ComparisonSourceValidationErrors = {}

  if (!input.name) errors.name = 'Name is required.'
  else if (input.name.length > NAME_MAX)
    errors.name = `Name must be ${NAME_MAX} characters or fewer.`

  if (!input.baseUrl) errors.baseUrl = 'Base URL is required.'
  else if (input.baseUrl.length > BASE_URL_MAX)
    errors.baseUrl = `Base URL must be ${BASE_URL_MAX} characters or fewer.`

  if (input.notes && input.notes.length > NOTES_MAX)
    errors.notes = `Notes must be ${NOTES_MAX} characters or fewer.`

  return errors
}

export async function createComparisonSource(
  input: ComparisonSourceInput,
): Promise<{ id: string }> {
  const inserted = await db
    .insert(comparisonSources)
    .values({
      name: input.name,
      baseUrl: input.baseUrl,
      isActive: input.isActive,
      notes: input.notes,
    })
    .returning({ id: comparisonSources.id })
  const row = inserted[0]
  if (!row) throw new Error('createComparisonSource: insert did not return a row')
  return { id: row.id }
}

export async function updateComparisonSource(
  id: string,
  input: ComparisonSourceInput,
): Promise<void> {
  await db
    .update(comparisonSources)
    .set({
      name: input.name,
      baseUrl: input.baseUrl,
      isActive: input.isActive,
      notes: input.notes,
      updatedAt: sql`now()`,
    })
    .where(eq(comparisonSources.id, id))
}

/**
 * Soft-delete: set is_active = false. Preserves the row so existing
 * citation objects that reference this source name remain coherent.
 */
export async function softDeleteComparisonSource(id: string): Promise<void> {
  await db
    .update(comparisonSources)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(eq(comparisonSources.id, id))
}
