// #51 — Pause/unpause HWM hard-reset (Round 6).
//
// When an operator flips a target from `active = false` → `active = true`,
// the next agent run should start fresh — i.e. its `high_water_mark` (the
// opaque jsonb the agent uses to remember "where I left off") gets cleared
// so the agent fetches everything from "now" onward instead of trying to
// resume across an indeterminate pause window.
//
// Implementation strategy:
//
//   The targets active-toggle endpoint sets `targets.hwm_reset_pending = true`
//   on every active=false → active=true transition (see
//   apps/web/app/api/settings/targets/[id]/active/route.ts and the targets-repo
//   `setTargetActive` helper).
//
//   This job each minute does a single UPDATE that consumes the flag:
//     SET high_water_mark = NULL, hwm_reset_pending = false
//     WHERE hwm_reset_pending = true
//
//   This is idempotent and self-healing. If the cron tick is missed for any
//   reason (sidecar restart, DB blip), the pending flag survives in Postgres
//   and gets processed on the next tick. No clock state to reconcile, no
//   "last sweep time" to remember.
//
// We considered comparing `targets.updated_at` to a remembered sweep time
// (no schema change needed) but rejected it: the cron sidecar would have to
// persist its own clock somewhere, and any clock skew or restart timing edge
// would leave HWM resets unprocessed. A boolean column is one more state bit
// in exchange for full idempotence — worth it.

import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { targets } from '@lucidindex/db/schema'
import { type JobDetails, runJob } from '../lib/run-job.js'

export async function runHwmReset(): Promise<void> {
  await runJob('hwm_reset', async (): Promise<JobDetails> => {
    const reset = await db
      .update(targets)
      .set({ highWaterMark: null, hwmResetPending: false })
      .where(eq(targets.hwmResetPending, true))
      .returning({ id: targets.id })

    return { reset: reset.length }
  })
}
