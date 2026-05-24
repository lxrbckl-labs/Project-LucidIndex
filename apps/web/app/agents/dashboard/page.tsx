/**
 * /agents/dashboard — public docs for the Dashboard MCP server.
 *
 * Renders the 12-tool surface exposed by `apps/mcp-dashboard`.
 * Content is fully static and driven by the in-repo catalog at
 * `../_lib/tool-catalog.ts`. No auth gate — anyone can read this.
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
