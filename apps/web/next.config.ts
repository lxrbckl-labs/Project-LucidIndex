import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// Workspace root (two levels up from apps/web). Set explicitly so Next's
// file tracer scans the full pnpm virtual store at the monorepo root, not
// just the app directory's local node_modules. Without this, the standalone
// output's tracing can miss workspace-level deps that resolve through
// `.pnpm/` symlinks — most painfully, native modules like `@node-rs/argon2`.
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Produce a self-contained `.next/standalone/` tree for Docker deployments.
  // The standalone output includes a minimal server.js + trimmed node_modules
  // so the runtime image doesn't need the full workspace installed.
  output: 'standalone',
  // Compile the workspace `@lucidindex/*` packages through SWC instead of
  // expecting pre-built JS — they're authored in TS and ship as source.
  transpilePackages: ['@lucidindex/auth', '@lucidindex/db'],
  // Keep these out of the bundler so their native bindings (`.node` files)
  // and Node-only deps load via plain `require` at runtime instead of
  // tripping webpack's "no loader for binary file" error.
  //
  // The flip side: nothing in the standalone bundle copies these into the
  // runner image automatically. The `apps/web/Dockerfile` runner stage
  // does a focused `npm install --no-save` for them — see the
  // "@node-rs/argon2 native binding" comment in that file for why we
  // can't rely on the standalone trace alone.
  serverExternalPackages: ['@node-rs/argon2', 'postgres', 'iron-session'],
  // Anchor file-tracing at the workspace root so the standalone output
  // walks the whole pnpm `.pnpm/` tree (workspace deps live there, not in
  // `apps/web/node_modules`). Without this, the standalone build emits a
  // warning that it can't resolve some workspace packages and silently
  // ships an incomplete bundle.
  outputFileTracingRoot: workspaceRoot,
  // Webpack resolver + loader shims for the workspace packages.
  webpack(config, { isServer }) {
    config.resolve = config.resolve || {}
    // `import './foo.js'` inside a workspace TS module should resolve to
    // `foo.ts` / `foo.tsx`. The `.js` extensions in `@lucidindex/auth` and
    // `@lucidindex/db` exist for Node ESM consumers (drizzle-kit, vitest)
    // which require them under `"type": "module"`. Next's bundler doesn't
    // do that rewrite by default.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    // Native binary modules (`.node`) reached transitively through workspace
    // packages in `transpilePackages` need `node-loader` to be emitted as
    // runtime `require(...)` calls. Without this, webpack tries to parse
    // the binary as JS and the request 500s.
    config.module = config.module || { rules: [] }
    config.module.rules = config.module.rules || []
    config.module.rules.push({
      test: /\.node$/,
      loader: 'node-loader',
    })
    if (isServer) {
      // Belt-and-suspenders: also tell webpack the native package is a
      // commonjs external on the server bundle, so it never gets walked.
      config.externals = config.externals || []
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals]
      externals.unshift('@node-rs/argon2')
      config.externals = externals
    }
    return config
  },
}

export default nextConfig
