/**
 * /agents/dashboard — public docs for the Dashboard MCP server.
 *
 * Renders the tool surface exposed by `apps/mcp-dashboard`.
 * Content is fully static and driven by the in-repo catalog at
 * `../_lib/tool-catalog.ts` — the canonical tool count lives there
 * (rendered into the page as `DASHBOARD_TOOLS.length`) so this header
 * doesn't drift when tools are added/removed. No auth gate — anyone
 * can read this.
 */

import type { Metadata } from 'next'
import { TopNav } from '@/components/chrome/TopNav'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConnectionSection } from '../_components/ConnectionSection'
import { ToolDoc } from '../_components/ToolDoc'
import {
  DASHBOARD_AUTH_FAILURE_REASONS,
  DASHBOARD_ERROR_CODES,
  DASHBOARD_TOOLS,
} from '../_lib/tool-catalog'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Dashboard MCP — Agents — LucidIndex',
  description:
    'Reference for the Dashboard MCP server: queue claim/ack flow, article writes, target metadata, and full-text search.',
}

export default function DashboardMcpDocsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopNav />
      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard MCP</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Queue claim/ack lifecycle, article writes, target-metadata curation, and full-text
              search across the article corpus.
            </p>
          </div>

          <div className="mt-10 flex flex-col gap-12">
            <ConnectionSection
              serverName="Dashboard MCP"
              inviteRoute="/settings/dashboard-agent-invites"
              defaultPort={4000}
            />

            <section aria-labelledby="quickstart-heading" className="flex flex-col gap-3">
              <h2 id="quickstart-heading" className="text-2xl font-semibold tracking-tight">
                Quickstart
              </h2>
              <p className="text-sm leading-relaxed">
                End-to-end: mint an invite, exchange it for a bearer token, then drive the tool
                surface over HTTP.
              </p>
              <ol className="flex flex-col gap-3 text-sm leading-relaxed ml-5 list-decimal">
                <li>
                  Mint an invite at{' '}
                  <code className="font-mono">/settings/dashboard-agent-invites</code> and copy the
                  onboarding prompt.
                </li>
                <li>
                  Redeem the invite —{' '}
                  <code className="font-mono">POST /api/agent-invites/dashboard/redeem</code> with{' '}
                  <code className="font-mono">{'{ invite_code }'}</code> returns{' '}
                  <code className="font-mono">{'{ token }'}</code>:
                  <pre className="mt-2 p-3 rounded-md border border-border bg-muted/40 text-xs font-mono overflow-x-auto">
                    {`curl -X POST http://localhost:47892/api/agent-invites/dashboard/redeem \\
  -H 'Content-Type: application/json' \\
  -d '{"invite_code":"<paste>"}'`}
                  </pre>
                </li>
                <li>
                  List tools:
                  <pre className="mt-2 p-3 rounded-md border border-border bg-muted/40 text-xs font-mono overflow-x-auto">
                    {`curl -X POST http://localhost:4000/mcp \\
  -H 'Authorization: Bearer <token>' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
                  </pre>
                </li>
                <li>
                  Pull work — <code className="font-mono">tools/call name=pull_queue_item</code>{' '}
                  (requires bearer auth; stdio cannot pull):
                  <pre className="mt-2 p-3 rounded-md border border-border bg-muted/40 text-xs font-mono overflow-x-auto">
                    {`curl -X POST http://localhost:4000/mcp \\
  -H 'Authorization: Bearer <token>' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"pull_queue_item","arguments":{}}}'`}
                  </pre>
                </li>
                <li>
                  Write back — three calls in order:
                  <ul className="mt-2 flex flex-col gap-2 ml-5 list-disc">
                    <li>
                      <code className="font-mono">check_article_exists({'{ source_url }'})</code> →{' '}
                      <code className="font-mono">{'{ exists, normalized }'}</code>. If{' '}
                      <code className="font-mono">exists: true</code>, skip; the response includes
                      the existing article so you can see what already covered it.
                    </li>
                    <li>
                      <code className="font-mono">
                        write_articles({'{ queue_item_id, articles }'})
                      </code>{' '}
                      → <code className="font-mono">{'{ accepted, results, failures }'}</code>. Each
                      result has <code className="font-mono">{'{ id, deduped, source_url }'}</code>.
                      Use <code className="font-mono">failures</code> to retry / report.
                    </li>
                    <li>
                      <code className="font-mono">
                        ack_queue_item(
                        {'{ queue_item_id, status, articles_count?, new_high_water_mark? }'})
                      </code>{' '}
                      →{' '}
                      <code className="font-mono">
                        {'{ ok, persisted: { articles_count, high_water_mark } }'}
                      </code>
                      . Persisted echo confirms what landed without a follow-up read.
                    </li>
                  </ul>
                </li>
              </ol>
            </section>

            <section aria-labelledby="dedup-heading" className="flex flex-col gap-3">
              <h2 id="dedup-heading" className="text-2xl font-semibold tracking-tight">
                Source dedup protocol
              </h2>
              <p className="text-sm leading-relaxed">
                Many agents poll many targets on a cadence. Two agents can reach the same source URL
                through different targets — and even if not, the same agent can rediscover a source
                it has already written about. URLs are canonicalized server-side (case, tracking
                params, fragments, default ports, www., trailing slashes all collapse), so
                cosmetically-different URLs that point at the same document collide on a single
                dedup key. Before doing the research+write work for a candidate source, follow this
                protocol:
              </p>
              <ol className="flex flex-col gap-2 text-sm leading-relaxed ml-5 list-decimal">
                <li>
                  Call <code className="font-mono">check_article_exists({'{ source_url }'})</code> —
                  if <code className="font-mono">exists: true</code>, abort. This is an O(1) lookup
                  and returns hidden + dashboard-invisible articles too, so you don&apos;t
                  re-research suppressed content.
                </li>
                <li>
                  (Optional) Call{' '}
                  <code className="font-mono">
                    search_articles({'{ query: title, include_suppressed: true }'})
                  </code>{' '}
                  for fuzzy title-level dedup across the corpus when the same story may have been
                  filed under a different URL.
                </li>
                <li>
                  If clean, call <code className="font-mono">write_articles({'{ ... }'})</code> with
                  the <code className="font-mono">citations</code> array populated with the source
                  URL and any other research links.
                </li>
              </ol>
            </section>

            <section aria-labelledby="tools-heading" className="flex flex-col gap-8">
              <div className="flex flex-col gap-2">
                <h2 id="tools-heading" className="text-2xl font-semibold tracking-tight">
                  Tools
                </h2>
                <p className="text-sm text-muted-foreground">
                  {DASHBOARD_TOOLS.length} tools. Names match the MCP discovery surface and the
                  snake_case identifier each handler is registered under.
                </p>
              </div>

              <div className="flex flex-col gap-10">
                {DASHBOARD_TOOLS.map((tool) => (
                  <ToolDoc key={tool.name} tool={tool} />
                ))}
              </div>
            </section>

            <section
              aria-labelledby="errors-heading"
              className="flex flex-col gap-4"
              data-testid="error-codes"
            >
              <h2 id="errors-heading" className="text-2xl font-semibold tracking-tight">
                Error codes
              </h2>

              <p className="text-sm leading-relaxed">
                Application-level failures surface as a{' '}
                <code className="font-mono">CallToolResult</code> with{' '}
                <code className="font-mono">isError: true</code>. The error code lives at{' '}
                <code className="font-mono">structuredContent.error.code</code> and a human-readable
                message at <code className="font-mono">structuredContent.error.message</code>. The
                same JSON is also stringified into{' '}
                <code className="font-mono">content[0].text</code> for clients that ignore{' '}
                <code className="font-mono">structuredContent</code>. Authorization failures happen
                earlier — see &quot;Authorization failures&quot; below.
              </p>

              <h3 className="text-lg font-semibold mt-2">Tool-level error codes</h3>

              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[35%]">Code</TableHead>
                      <TableHead>Meaning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DASHBOARD_ERROR_CODES.map((e) => (
                      <TableRow key={e.code}>
                        <TableCell className="font-mono text-xs align-top">{e.code}</TableCell>
                        <TableCell className="text-sm align-top leading-relaxed">
                          {e.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <h3 className="text-lg font-semibold mt-4">Authorization failures (HTTP 401)</h3>
              <p className="text-sm leading-relaxed">
                If bearer-token auth fails, the server responds with HTTP 401 before invoking any
                tool. The response body is{' '}
                <code className="font-mono">{'{ error: "unauthorized", reason: <reason> }'}</code>
                {'. The reason is one of:'}
              </p>
              <ul className="flex flex-col gap-1 text-sm leading-relaxed ml-5 list-disc">
                {DASHBOARD_AUTH_FAILURE_REASONS.map((r) => (
                  <li key={r} className="font-mono text-xs">
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
