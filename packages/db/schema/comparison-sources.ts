import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Canonical external sources the agent consults when analyzing articles
 * (e.g. Wikipedia, Associated Press, Reuters). Admins manage this list
 * via Settings → Comparison sources. When an agent produces an article it
 * attaches citation objects (stored as jsonb on `articles.citations`) that
 * reference one of these sources by name.
 *
 * "Soft delete" — set `is_active = false` instead of deleting rows so
 * existing citation objects that reference a source name remain coherent.
 */
export const comparisonSources = pgTable('comparison_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
})
