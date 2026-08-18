// Hero-image pipeline binding for the mcp-dashboard sidecar.
//
// The mechanics of fetch + sharp resize + WebP/JPEG content-hash write
// live in @lucidindex/shared/image-pipeline so the LUCIDINDEX_SEED_DEMO
// stress-test seeder (packages/db/seed-demo.ts) can reuse the SAME path —
// same disk layout, same hash format, same outputs. This file is just the
// mcp-dashboard-flavored binding: env config + structured logger.

import {
  type FetchHeroImageResult,
  fetchAndStoreHeroImage as sharedFetchAndStoreHeroImage,
} from '@lucidindex/shared/image-pipeline'
import env from '../env.js'
import { logger } from '../logger.js'

export type { FetchHeroImageResult }

export async function fetchAndStoreHeroImage(url: string): Promise<FetchHeroImageResult> {
  return sharedFetchAndStoreHeroImage(
    url,
    {
      imageDir: env.MCP_IMAGE_DIR,
      fetchTimeoutMs: env.MCP_IMAGE_FETCH_TIMEOUT_MS,
      maxBytes: env.MCP_IMAGE_MAX_BYTES,
      maxWidth: env.MCP_IMAGE_MAX_WIDTH,
    },
    logger,
  )
}
