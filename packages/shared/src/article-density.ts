/**
 * Content-density helpers for the masonry's card-variant routing.
 *
 * The purpose is to prevent a "would-be Large" article from occupying a
 * 2×2 hero tile when its renderable text is too thin to fill the frame.
 * Important-but-short articles demote to a Small tile rather than
 * rendering as a hero with a sad two-sentence summary.
 *
 * **Field availability note:** `ArticleCardView` (the shape the masonry
 * consumes) does not carry `agentDeepDive` / `body` — the dashboard loader
 * projects only `summary` from the DB. Therefore `articleRenderableWords`
 * scores on `summary` alone and the threshold is set accordingly (40 words
 * vs the 80 that would apply if a body field were also available). If a
 * future loader pass surfaces a `body` or `excerpt` field into the card
 * view, add it to the `article` parameter below and raise the threshold.
 */

/**
 * Word-count threshold below which a Large-eligible article gets demoted
 * to a Small tile. Tuned to what `LargeArticleCard` actually renders:
 * the large variant collapses the summary (only title + byline overlay are
 * shown), so the proxy for "enough content to deserve a hero slot" is the
 * summary word count — it correlates with overall article depth even though
 * the summary itself is hidden in the large frame.
 *
 * 40 words ≈ two substantive sentences: enough that an agent wrote
 * something meaningful. Below this the article is likely a stub or a
 * headline-only capture.
 *
 * Raise this constant (and add `body` / `excerpt` to the helper below)
 * once those fields land in `ArticleCardView`.
 */
export const MIN_LARGE_WORD_COUNT = 40

/**
 * Count the words in `text`. Uses a Unicode-aware regex that matches runs
 * of letters, digits, and apostrophes — avoids splitting on punctuation,
 * handles em-dashes, hyphens inside compounds, and accented letters.
 *
 * Returns 0 for null / undefined / empty / punctuation-only input.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  // Match runs of word-characters (Unicode letter/number categories) plus
  // apostrophes so contractions and possessives count as one word.
  const matches = text.match(/[\p{L}\p{N}']+/gu)
  return matches?.length ?? 0
}

/**
 * Renderable density for a card — word count across the text fields that
 * reflect the article's depth. Excludes title (always present, doesn't
 * fill the body region) and metadata.
 *
 * Currently scores on `summary` only because `ArticleCardView` does not
 * carry a body / excerpt field. See the module-level note above.
 */
export function articleRenderableWords(article: { summary?: string | null }): number {
  return countWords(article.summary)
}

/**
 * Combine a "wants large" intent (driven by significance / slot assignment)
 * with a content-density floor. An article that signaled large but lacks
 * the words to fill the frame gets demoted to small.
 *
 * @param article - The card view (needs `summary` for density scoring).
 * @param intent  - What the slot assignment says: 'large' | 'small'.
 * @returns       - Effective card size after applying the density gate.
 */
export function effectiveCardSize(
  article: { summary?: string | null },
  intent: 'large' | 'small',
): 'large' | 'small' {
  if (intent === 'small') return 'small'
  return articleRenderableWords(article) >= MIN_LARGE_WORD_COUNT ? 'large' : 'small'
}
