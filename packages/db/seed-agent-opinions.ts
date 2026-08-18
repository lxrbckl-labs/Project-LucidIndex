/**
 * seed-agent-opinions — idempotent backfill script.
 *
 * Two jobs:
 *
 *   1. For every article where `agent_opinion IS NULL`, generate a
 *      faker-based opinion paragraph (1–3 sentences, plausible analyst
 *      tone) and update the row.
 *
 *   2. For every `prompt_templates.body` that does NOT yet contain the
 *      `AGENT_OPINION_INSTRUCTION` marker, append the instruction so
 *      existing seeded templates in the DB match the new starter
 *      definitions.
 *
 * Idempotent: safe to run multiple times. Articles that already have an
 * opinion are skipped; templates that already contain the marker are skipped.
 *
 * Run via:
 *   pnpm db:seed-agent-opinions
 */

import { faker } from '@faker-js/faker'
import { appendOpinionInstruction, hasOpinionInstruction } from '@lucidindex/templates'
import { eq, isNull } from 'drizzle-orm'
import { db } from './client.js'
import { articles, promptTemplates } from './schema/index.js'

// Fix RNG seed for reproducibility on a fresh DB — does NOT prevent the
// script from being run on an already-seeded DB (rows with opinions are
// skipped, so no overwriting of previously set values).
faker.seed(99)

// ---------------------------------------------------------------------------
// Analyst-tone opinion sentences
// ---------------------------------------------------------------------------

const STRONG_PHRASES = [
  'The sourcing is unusually thorough for this format',
  'The argument is well-structured and avoids the usual hedging',
  'The data cited checks out against primary sources',
  'The framing is cleaner than comparable coverage',
  'The editorial voice is consistent and earns trust',
  'The analysis cuts to the mechanism rather than the surface symptom',
  'The caveats are placed where they matter most',
]

const WEAK_PHRASES = [
  'the headline oversells the underlying data',
  'the lede buries the most important point',
  'the cross-source set leans too heavily on a single outlet',
  'the counterargument is dismissed in a single sentence',
  'the methodology section is conspicuously absent',
  'the conclusion overreaches what the evidence supports',
  'the context window is too narrow — the longer trend is missing',
]

const PUSHBACK_PHRASES = [
  'Worth pushback: the comparison baseline is cherry-picked.',
  'Worth pushback: the causal claim needs a stronger instrument.',
  'Worth pushback: the sample size is not disclosed.',
  'The key assumption here deserves more scrutiny before accepting the conclusion.',
  'Readers should probe the cited figure — the primary source tells a more complex story.',
]

/** Generate a 1–3 sentence analyst-tone opinion paragraph. */
function generateOpinion(): string {
  const sentences: string[] = []

  // Sentence 1: strong point
  sentences.push(`${faker.helpers.arrayElement(STRONG_PHRASES)}.`)

  // Sentence 2: weakness (always included for balance)
  sentences.push(`However, ${faker.helpers.arrayElement(WEAK_PHRASES)}.`)

  // Sentence 3: pushback (50% chance)
  if (faker.datatype.boolean()) {
    sentences.push(faker.helpers.arrayElement(PUSHBACK_PHRASES))
  }

  return sentences.join(' ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[seed-agent-opinions] Starting backfill…')

  // --- Job 1: articles ---
  const nullOpinionArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .where(isNull(articles.agentOpinion))

  console.log(
    `[seed-agent-opinions] Found ${nullOpinionArticles.length} articles with null agent_opinion`,
  )

  let articlesUpdated = 0
  for (const row of nullOpinionArticles) {
    const opinion = generateOpinion()
    await db.update(articles).set({ agentOpinion: opinion }).where(eq(articles.id, row.id))
    articlesUpdated++
  }

  console.log(`[seed-agent-opinions] Updated ${articlesUpdated} articles`)

  // --- Job 2: prompt_templates ---
  const allTemplates = await db
    .select({ id: promptTemplates.id, slug: promptTemplates.slug, body: promptTemplates.body })
    .from(promptTemplates)

  let templatesPatched = 0
  for (const tmpl of allTemplates) {
    if (hasOpinionInstruction(tmpl.body)) continue
    const patchedBody = appendOpinionInstruction(tmpl.body)
    await db
      .update(promptTemplates)
      .set({ body: patchedBody })
      .where(eq(promptTemplates.id, tmpl.id))
    templatesPatched++
    console.log(`[seed-agent-opinions]   patched template: ${tmpl.slug}`)
  }

  console.log(
    `[seed-agent-opinions] Patched ${templatesPatched}/${allTemplates.length} prompt templates`,
  )
  console.log('[seed-agent-opinions] Done.')
}

main().catch((err) => {
  console.error('[seed-agent-opinions] Fatal error:', err)
  process.exit(1)
})
