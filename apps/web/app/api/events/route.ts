/**
 * SSE endpoint for the dashboard's live article ticker (#60).
 *
 *   GET /api/events  →  text/event-stream
 *
 * Auth: gated by `requireAdmin()`. Anonymous callers get 401, no stream.
 *
 * Why Node, not Edge:
 *   The Edge runtime's response-streaming story for Server-Sent Events
 *   is fragile in Next 15 — the stream gets buffered behind some hosts
 *   and `requireAdmin()` reaches into iron-session, which itself wants
 *   the Node `crypto` module. `runtime = 'nodejs'` is explicit so we
 *   never accidentally regress to Edge if the framework default flips.
 *
 * Stream shape:
 *
 *   - One event line per article emit:
 *       event: article:new
 *       data: <json payload>
 *
 *   - A periodic comment heartbeat (`: ping`) every 25 seconds keeps
 *     intermediate proxies (Vercel's edge cache, nginx with default
 *     `proxy_read_timeout`) from killing the connection. EventSource
 *     auto-reconnects, but we'd rather not depend on that on a healthy
 *     network.
 *
 *   - On client disconnect (`request.signal.aborted`) we unsubscribe
 *     from the in-process bus and tear down the heartbeat timer so
 *     listeners don't leak on HMR or page navigation.
 *
 * Cross-process source-of-truth is a future ticket — see the TODO in
 * `apps/web/lib/sse/article-bus.ts`. For v0.1 the only thing that can
 * publish into the bus is the dev-only `/api/events/test` route.
 */

import { requireAdmin } from '@lucidindex/auth'
import { type ArticleEvent, subscribe } from '@/lib/sse/article-bus'

export const runtime = 'nodejs'
// Avoid any `next dev` static-render attempts on a streaming endpoint —
// the response is request-scoped and infinite-tailed by definition.
export const dynamic = 'force-dynamic'

// Mock mode bypasses the session gate the same way `app/page.tsx` does —
// the visual gate runs against a flag-driven dev server with no founding
// admin, so requireAdmin() always returns null. Production code paths
// still require a real authenticated session.
const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

const HEARTBEAT_INTERVAL_MS = 25_000
const ENCODER = new TextEncoder()

function formatEvent(event: ArticleEvent): string {
  // Per the SSE spec the trailing blank line ends the event. JSON-encode
  // the payload so multiline values can't accidentally split frames.
  const data = JSON.stringify(event.payload)
  return `event: ${event.type}\ndata: ${data}\n\n`
}

export async function GET(request: Request) {
  if (!MOCK_MODE) {
    const session = await requireAdmin()
    if (!session) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(ENCODER.encode(chunk))
        } catch {
          // The underlying connection was torn down between checks; the
          // abort handler below will clean up.
          closed = true
        }
      }

      // Initial framing: a comment line gives some intermediaries a
      // chance to flush headers + open the response to the client.
      safeEnqueue(': stream-open\n\n')

      const unsubscribe = subscribe((event) => {
        safeEnqueue(formatEvent(event))
      })

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping ${Date.now()}\n\n`)
      }, HEARTBEAT_INTERVAL_MS)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime — no-op.
        }
      }

      // Client disconnect. AbortSignal fires on tab close, navigation,
      // and on `next dev` HMR. Without this we'd leak bus listeners.
      request.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable buffering for known proxies. `X-Accel-Buffering: no`
      // is the nginx + Vercel edge convention.
      'X-Accel-Buffering': 'no',
    },
  })
}
