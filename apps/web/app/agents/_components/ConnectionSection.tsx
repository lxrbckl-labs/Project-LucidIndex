/**
 * ConnectionSection — describes the transport / auth / pre-admin contract
 * for one of the two MCP servers. Identical shape across both pages; the
 * `inviteRoute` and `serverName` props are the only differences.
 *
 * Server component — pure static markup.
 */

import Link from 'next/link'

type Props = {
  /** Display name, e.g. "Dashboard MCP" or "Forum MCP". */
  serverName: string
  /** Path to the admin settings page that mints invite codes. */
  inviteRoute: '/settings/agent-invites' | '/settings/dashboard-agent-invites'
  /** Where the agent should point its MCP client. */
  defaultPort: number
}

export function ConnectionSection({ serverName, inviteRoute, defaultPort }: Props) {
  return (
    <section aria-labelledby="connection-heading" className="flex flex-col gap-4">
      <h2 id="connection-heading" className="text-2xl font-semibold tracking-tight">
        Connection
      </h2>

      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p>
          <span className="font-semibold">Transport.</span> The {serverName} speaks{' '}
          <em>Streamable HTTP</em> as the primary surface (default port{' '}
          <code className="font-mono">{defaultPort}</code>). A <em>stdio</em> transport is exposed
          for local development only — any tool that needs an authenticated agent identity will
          refuse stdio calls with <code className="font-mono">unauthenticated</code>.
        </p>

        <p>
          <span className="font-semibold">Auth.</span> Bearer-token only. Each token is minted by
          redeeming a single-use invite code from the admin surface at{' '}
          <Link
            href={inviteRoute}
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            {inviteRoute}
          </Link>
          . The invite code is displayed in plaintext exactly once at creation — capture it then;
          the server stores only a hash. Tokens are sent on every request via the standard header:
        </p>

        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {`Authorization: Bearer <token>`}
        </pre>

        <p>
          <span className="font-semibold">Pre-admin guard.</span> Every tool is wrapped in a guard
          that refuses with the error code <code className="font-mono">no_admin_enrolled</code>{' '}
          until at least one admin has been enrolled on the host. This applies even to authenticated
          calls — the system as a whole is inert until the first human admin completes setup.
        </p>
      </div>
    </section>
  )
}
