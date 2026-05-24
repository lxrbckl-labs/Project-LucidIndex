// Liquid template rendering for prompt bodies. Owned by #44.
//
// `pull_queue_item` returns the rendered prompt to the agent. The raw
// template body lives in `prompt_templates.body`; this module renders it
// against the per-target context vars described in [[MCP]] and the starter
// templates in `@lucidindex/templates`:
//
//   creator_name      — from target.label
//   target_url        — from target.url_or_handle
//   high_water_mark   — opaque jsonb from target.high_water_mark (may be null)
//   cadence           — from target.cadence
//   cross_references  — from prompt_template.cross_source_n (clean name)
//   cross_source_n    — alias of cross_references for back-compat with
//                       admin-edited templates that use the older name
//
// strictFilters mirrors `validateLiquidSyntax` — a typo in a filter name is
// a hard error rather than a silent empty render. strictVariables is left
// off because templates author-time may reference variables we don't pass
// (operator-customized prompts), and we want render to succeed (empty
// substitution) rather than throw.

import { Liquid } from 'liquidjs'

const engine = new Liquid({ strictFilters: true, strictVariables: false })

export type RenderContext = {
  creator_name: string
  target_url: string
  high_water_mark: unknown
  cadence: string
  /**
   * Number of independent cross-coverage entries the agent should aim for.
   * Both `cross_references` (new clean name) and `cross_source_n` (legacy
   * alias) are provided in the render context so admin-edited templates
   * using the older variable name keep rendering.
   */
  cross_source_n: number
}

/**
 * Friendly fallback string substituted for `high_water_mark` when the
 * target hasn't been processed yet (first-run case — `targets.high_water_mark`
 * is null). Without this, a starter template like:
 *
 *     Pull new posts published after the high_water_mark:
 *
 *       {{ high_water_mark }}
 *
 * renders to a body containing `  \n\n` (two spaces between blank lines)
 * — confusing for the agent. The renderer substitutes this string so the
 * rendered prompt is self-explanatory on a fresh target without forcing
 * every starter body to carry an `{% if high_water_mark %}` branch.
 *
 * Format kept short + parenthetical so it slots cleanly into the
 * existing indented-block spot in the starter prompts.
 */
const FIRST_RUN_HWM_PLACEHOLDER =
  '(none — this is the first run for this target; pull everything published in the last 30 days)'

/**
 * Render a Liquid template body against the target/template context.
 *
 * `high_water_mark` is jsonb-opaque; we pass it through verbatim when set.
 * When it's null (first-run case), we substitute a friendly
 * `(none — first run, pull recent posts)` string so the rendered prompt
 * doesn't end up with a `  \n\n` blank-substitution hole where the hwm
 * would normally appear. LiquidJS stringifies non-primitive values via
 * `String(...)` which produces `[object Object]` for plain objects —
 * usable but ugly. Templates that want pretty rendering can use
 * `{{ high_water_mark | json }}`.
 *
 * Errors raised by liquidjs during render bubble up — pull_queue_item
 * surfaces them as `template_render_failed` ToolErrors so the agent can
 * see WHICH template broke instead of "internal_error".
 */
export async function renderPromptBody(body: string, ctx: RenderContext): Promise<string> {
  // Friendly first-run fallback for null hwm. We treat both `null` and
  // `undefined` as the first-run case; truthy/primitive/object values
  // pass through verbatim so the agent sees its own opaque jsonb shape.
  const hwmForRender = ctx.high_water_mark == null ? FIRST_RUN_HWM_PLACEHOLDER : ctx.high_water_mark

  // Expose `cross_references` as the canonical name; keep `cross_source_n`
  // as an alias so admin-edited templates using the older variable name
  // keep rendering against the same source field.
  const expanded = {
    ...ctx,
    high_water_mark: hwmForRender,
    cross_references: ctx.cross_source_n,
  }
  return engine.parseAndRender(body, expanded as unknown as Record<string, unknown>)
}
