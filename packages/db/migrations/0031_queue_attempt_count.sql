-- 0031 — `queue.attempt_count` (P2 / audit round 3).
--
-- Background: the queue claim loop has no visibility into how many times a
-- given row has been pulled before. A row that the reaper has unstuck
-- repeatedly is indistinguishable from a fresh row, so an agent can't decide
-- to back off / escalate / mark as poison.
--
-- This adds an `attempt_count integer NOT NULL DEFAULT 0` column. The
-- dashboard MCP's `pull_queue_item` increments it inside the atomic claim
-- UPDATE and returns the post-increment value in the pull response. Agents
-- branch on it (e.g. `if attempt_count >= 3 { escalate }`).
--
-- Existing rows default to 0 — they're treated as "first attempt" by the
-- next pull, which is the conservative choice (no false positives for
-- "poison" treatment).

ALTER TABLE "queue"
  ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0;
