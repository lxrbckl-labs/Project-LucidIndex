/**
 * Liquid syntax validation for prompt templates.
 *
 * The mcp-dashboard sidecar (Phase 3) renders these templates against a real
 * context at queue-pull time. This module is intentionally narrower: it
 * only verifies the body PARSES as valid Liquid. We deliberately don't
 * execute against a context here — render correctness is mcp-dashboard's job,
 * and we don't want a typo in a sample context to mask a real syntax error
 * (or vice versa).
 *
 * `strictFilters: true` means a typo in a filter name (e.g. `{{ name | uperc }}`
 * for `upcase`) becomes a parse-time error rather than silently rendering
 * empty. `strictVariables: false` keeps unknown variable names as a
 * RENDER-time concern — at parse time we don't know which variables the
 * agent will be given, so we accept anything.
 */

import { Liquid } from 'liquidjs'

const engine = new Liquid({ strictFilters: true, strictVariables: false })

/**
 * Validates Liquid syntax. Returns null on valid; returns an error message
 * string on invalid. Does NOT execute the template against a context.
 */
export function validateLiquidSyntax(body: string): string | null {
  try {
    engine.parse(body)
    return null
  } catch (e) {
    return (e as Error).message
  }
}
