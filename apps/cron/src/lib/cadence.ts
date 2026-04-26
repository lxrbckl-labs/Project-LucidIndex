// Cadence helper for the cron sidecar.
//
// The Targets panel (#32) stores cadence as one of four literal preset strings
// (see apps/web/app/settings/targets/_lib/targets-repo.ts → CADENCE_PRESETS).
// The scheduler (#49) consumes those presets and computes the next due time
// from "now."
//
// This is intentionally narrow — Phase 4 doesn't need full cron-expression
// support. If we ever expand the preset set on the form, mirror it here. An
// unknown cadence falls back to hourly + a structured warn log so the operator
// can spot drift on the System dashboard (Phase 7).

import { logger } from '../logger.js'

const ONE_MINUTE_MS = 60 * 1000
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS

/**
 * Compute the next-due timestamp for a target with the given cadence preset.
 *
 * @param cadence - One of the v0.1 presets: `every 5 minutes`, `hourly`,
 *                  `every 4 hours`, `daily`. Anything else is treated as
 *                  hourly + warn.
 * @param from    - Anchor (defaults to `new Date()`). Pass an explicit value
 *                  in tests for determinism.
 */
export function nextDueAt(cadence: string, from: Date = new Date()): Date {
  switch (cadence) {
    case 'every 5 minutes':
      return new Date(from.getTime() + 5 * ONE_MINUTE_MS)
    case 'hourly':
      return new Date(from.getTime() + ONE_HOUR_MS)
    case 'every 4 hours':
      return new Date(from.getTime() + 4 * ONE_HOUR_MS)
    case 'daily':
      return new Date(from.getTime() + 24 * ONE_HOUR_MS)
    default:
      // Fallback for unknown cadence: treat as hourly + warn so the operator
      // can spot any drift between the form's preset list and this helper.
      logger.warn('unknown_cadence_defaulting_to_hourly', { cadence })
      return new Date(from.getTime() + ONE_HOUR_MS)
  }
}
