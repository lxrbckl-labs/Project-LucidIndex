import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produce a self-contained `.next/standalone/` tree for Docker deployments.
  // The standalone output includes a minimal server.js + trimmed node_modules
  // so the runtime image doesn't need the full workspace installed.
  output: 'standalone',
}

export default nextConfig
