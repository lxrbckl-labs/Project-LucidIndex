/**
 * Tests for the Settings-layer pure helpers used by `seed-demo.ts`.
 *
 * Same split-from-the-DB-touching-wrapper rationale as
 * `seed-demo.test.ts`: the live seeder hits Postgres + the network and is
 * exercised by the docker-compose smoke flow, while the deterministic
 * pieces of logic are unit-tested here without dependencies.
 */

import { describe, expect, it } from 'vitest'
import {
  buildCustomizedTemplates,
  buildDemoAgentTokenLabels,
  CUSTOMIZED_TEMPLATES,
  chooseSettingsNonDefaults,
  DEMO_AGENT_TOKEN_LABELS,
  DEMO_OFF_SITE_BACKUP_CREDENTIALS_PLACEHOLDER,
  DEMO_OFF_SITE_BACKUP_REMOTE,
} from './seed-demo-settings.js'

describe('buildDemoAgentTokenLabels', () => {
  const NOW = new Date('2026-04-27T12:00:00Z')

  it('returns one entry per DEMO_AGENT_TOKEN_LABELS', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    expect(rows).toHaveLength(DEMO_AGENT_TOKEN_LABELS.length)
  })

  it('preserves labels in declaration order', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    expect(rows.map((r) => r.label)).toEqual(DEMO_AGENT_TOKEN_LABELS.map((d) => d.label))
  })

  it('subtracts ageDays from now to compute createdAt', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    for (let i = 0; i < rows.length; i++) {
      const expectedMs = NOW.getTime() - (DEMO_AGENT_TOKEN_LABELS[i]?.ageDays ?? 0) * 86_400_000
      expect(rows[i]?.createdAt.getTime()).toBe(expectedMs)
    }
  })

  it('sets revokedAt only on entries flagged revoked', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    for (let i = 0; i < rows.length; i++) {
      if (DEMO_AGENT_TOKEN_LABELS[i]?.revoked) {
        expect(rows[i]?.revokedAt).toBeInstanceOf(Date)
      } else {
        expect(rows[i]?.revokedAt).toBeNull()
      }
    }
  })

  it('places revokedAt strictly after the matching createdAt', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    for (const r of rows) {
      if (r.revokedAt) {
        expect(r.revokedAt.getTime()).toBeGreaterThan(r.createdAt.getTime())
      }
    }
  })

  it('places revokedAt strictly before now', () => {
    const rows = buildDemoAgentTokenLabels(NOW)
    for (const r of rows) {
      if (r.revokedAt) {
        expect(r.revokedAt.getTime()).toBeLessThan(NOW.getTime())
      }
    }
  })

  it('is deterministic — same now produces same rows', () => {
    const a = buildDemoAgentTokenLabels(NOW)
    const b = buildDemoAgentTokenLabels(NOW)
    expect(a).toEqual(b)
  })

  it('contains exactly one revoked token in the demo set', () => {
    // Round 8 spec: "~1 should be revoked" — assert this so a future
    // refactor doesn't silently drop the revoked-token UI from the
    // Settings panel demo.
    const revokedCount = DEMO_AGENT_TOKEN_LABELS.filter((d) => d.revoked).length
    expect(revokedCount).toBe(1)
  })

  it('seeds at least 5 extra labels (lived-in target volume)', () => {
    expect(DEMO_AGENT_TOKEN_LABELS.length).toBeGreaterThanOrEqual(5)
  })

  it('seeds at most 8 extra labels (Round 8 cap)', () => {
    expect(DEMO_AGENT_TOKEN_LABELS.length).toBeLessThanOrEqual(8)
  })
})

describe('buildCustomizedTemplates', () => {
  it('returns the canonical CUSTOMIZED_TEMPLATES list', () => {
    const rows = buildCustomizedTemplates()
    expect(rows).toBe(CUSTOMIZED_TEMPLATES)
  })

  it('uses slugs that do not collide with the 7 starter slugs', () => {
    // Starter slugs from `@lucidindex/templates` STARTER_TEMPLATES —
    // pinned here so this test stays self-contained (no workspace dep).
    const STARTER_SLUGS = new Set([
      'youtube',
      'blog',
      'newsletter',
      'news',
      'instagram',
      'x',
      'website',
    ])
    for (const t of CUSTOMIZED_TEMPLATES) {
      expect(STARTER_SLUGS.has(t.slug)).toBe(false)
    }
  })

  it('has unique slugs across the customized set', () => {
    const slugs = CUSTOMIZED_TEMPLATES.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('varies cross_source_n across the variants (the point of the variants)', () => {
    const ns = new Set(CUSTOMIZED_TEMPLATES.map((t) => t.crossSourceN))
    // Settings → Templates becomes flat if every customized variant uses
    // the same N. Round 8 explicitly wants visible variety.
    expect(ns.size).toBeGreaterThan(1)
  })

  it('seeds 3-5 customized variants (Round 8 spec)', () => {
    expect(CUSTOMIZED_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    expect(CUSTOMIZED_TEMPLATES.length).toBeLessThanOrEqual(5)
  })

  it('non-empty bodies', () => {
    for (const t of CUSTOMIZED_TEMPLATES) {
      expect(t.body.length).toBeGreaterThan(0)
    }
  })
})

describe('chooseSettingsNonDefaults', () => {
  it('chooses values that differ from the schema defaults', () => {
    const result = chooseSettingsNonDefaults()
    // Schema defaults: strict_mode=false, new_article_badge_hours=24.
    expect(result.strictMode).not.toBe(false)
    expect(result.newArticleBadgeHours).not.toBe(24)
  })

  it('is deterministic', () => {
    expect(chooseSettingsNonDefaults()).toEqual(chooseSettingsNonDefaults())
  })

  it('keeps newArticleBadgeHours within a sensible range', () => {
    const result = chooseSettingsNonDefaults()
    // The UI is meaningless if this is 0 or absurdly large; sanity-bound
    // it so a future "lived in" tweak doesn't silently break the panel.
    expect(result.newArticleBadgeHours).toBeGreaterThan(0)
    expect(result.newArticleBadgeHours).toBeLessThan(24 * 30)
  })
})

describe('off-site-backup placeholder constants', () => {
  it('remote name reads like a real rclone remote (`<remote>:<path>`)', () => {
    expect(DEMO_OFF_SITE_BACKUP_REMOTE).toMatch(/^[a-z][a-z0-9-]*:[a-z0-9-]+$/i)
  })

  it('credentials placeholder is clearly marked DO NOT RUN', () => {
    expect(DEMO_OFF_SITE_BACKUP_CREDENTIALS_PLACEHOLDER).toMatch(/DEMO_PLACEHOLDER/)
    expect(DEMO_OFF_SITE_BACKUP_CREDENTIALS_PLACEHOLDER).toMatch(/DO_NOT_RUN/i)
  })
})
