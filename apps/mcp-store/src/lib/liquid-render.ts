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
//   cross_source_n    — from prompt_template.cross_source_n
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
  cross_source_n: number
}

/**
 * Render a Liquid template body against the target/template context.
 *
 * `high_water_mark` is jsonb-opaque; we pass it through verbatim. LiquidJS
 * stringifies non-primitive values via `String(...)` which produces
 * `[object Object]` for plain objects — usable but ugly. Templates that
 * want pretty rendering can use `{{ high_water_mark | json }}`. The
 * starter templates print it raw in a code block context, which is
 * fine for null and for primitive values.
 *
 * Errors raised by liquidjs during render bubble up — pull_queue_item
 * surfaces them as `template_render_failed` ToolErrors so the agent can
 * see WHICH template broke instead of "internal_error".
 */
export async function renderPromptBody(body: string, ctx: RenderContext): Promise<string> {
  return engine.parseAndRender(body, ctx as unknown as Record<string, unknown>)
}
