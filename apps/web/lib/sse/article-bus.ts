/**
 * In-process article event bus (#60).
 *
 * Phase 5 ships SSE for the dashboard so newly-filed articles fade in
 * without a full grid reflow. The cross-process story (mcp-store →
 * apps/web) is OUT OF SCOPE for this PR — that's a future ticket and
 * will probably be implemented via Postgres LISTEN/NOTIFY (free with
 * the existing DB connection) or a Redis pub/sub channel.
 *
 *   TODO(future ticket): cross-process SSE between mcp-store and web.
 *   Likely Postgres LISTEN/NOTIFY: `mcp-store` issues `NOTIFY
 *   article_new, '<json>'` after a successful insert; the web process
 *   keeps a long-lived `LISTEN` connection and forwards every
 *   notification onto this same in-process bus. That keeps THIS module
 *   the single fan-out point so the route handler doesn't need to grow
 *   a second branch.
 *
 * For v0.1 the bus is a singleton living inside the `apps/web` Node
 * process. Its public API is intentionally minimal:
 *
 *   subscribe(listener) → unsubscribe()   for the SSE route handler
 *   publish(event)                         for in-process emitters
 *                                          (currently the dev-only
 *                                          `/api/events/test` route)
 *
 * The bus is module-scoped, but Next.js route handlers in dev can be
 * re-evaluated on edit, which would normally drop subscribers. We pin
 * the bus to `globalThis` under a Symbol-keyed slot so HMR doesn't
 * blow it away — same trick `next/postgres` and `drizzle` use.
 */

export type ArticleNewPayload = {
  id: string
  slug: string
  title: string
  summary: string
  topicBadges: string[]
  significance: 'small' | 'medium' | 'large'
  publishedLabel: string
  publishedEstimated: boolean
  heroImageUrl: string
  agentLabel: string
  readMinutes: number
}

export type ArticleEvent = { type: 'article:new'; payload: ArticleNewPayload }

type Listener = (event: ArticleEvent) => void

type Bus = {
  listeners: Set<Listener>
}

const BUS_KEY = Symbol.for('lucidindex.sse.article-bus')

type Globals = typeof globalThis & {
  [BUS_KEY]?: Bus
}

function getBus(): Bus {
  const g = globalThis as Globals
  let bus = g[BUS_KEY]
  if (!bus) {
    bus = { listeners: new Set() }
    g[BUS_KEY] = bus
  }
  return bus
}

/**
 * Subscribe to article events. Returns the unsubscribe function — call
 * it on stream close so we don't leak listeners across reconnects.
 */
export function subscribe(listener: Listener): () => void {
  const bus = getBus()
  bus.listeners.add(listener)
  return () => {
    bus.listeners.delete(listener)
  }
}

/**
 * Publish an event to every current subscriber. Listener errors are
 * caught individually so one bad subscriber never starves the rest.
 */
export function publish(event: ArticleEvent): void {
  const bus = getBus()
  for (const listener of bus.listeners) {
    try {
      listener(event)
    } catch {
      // Best-effort fan-out; a thrown listener is its own bug, not the
      // bus's. We deliberately don't `console.error` here — the SSE
      // route already logs disconnects, and the dev console gets
      // enough chatter from `next dev`.
    }
  }
}
