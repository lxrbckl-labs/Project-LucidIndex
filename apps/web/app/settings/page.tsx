/**
 * /settings — the authenticated hub (Phase 2).
 *
 * Grid of shadcn Cards showing each sub-panel with a one-line description.
 */

import Link from 'next/link'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const PANELS: ReadonlyArray<{ href: string; title: string; blurb: string }> = [
  {
    href: '/settings/account',
    title: 'Account',
    blurb: 'Registered passkeys, register another device, regenerate recovery code.',
  },
  {
    href: '/settings/targets',
    title: 'Targets',
    blurb: 'Sources the agent crawls — feeds, sites, and ingestion targets.',
  },
  {
    href: '/settings/badges',
    title: 'Badges',
    blurb: 'Curated badges, agent-suggested badge inbox, and bulk actions.',
  },
  {
    href: '/settings/templates',
    title: 'Templates',
    blurb: 'Prompt templates with Liquid validation and starter library.',
  },
  {
    href: '/settings/agent-tokens',
    title: 'Agent tokens',
    blurb: 'Issue, display once, hash, and revoke tokens for headless agents.',
  },
  {
    href: '/settings/off-site-backup',
    title: 'Off-site backup',
    blurb: 'Configure the rclone remote that receives nightly DB dumps.',
  },
  {
    href: '/settings/system',
    title: 'System',
    blurb: 'Cron run history, queue depth, and drift histograms.',
  },
  {
    href: '/settings/hidden-articles',
    title: 'Hidden articles',
    blurb: 'List and restore articles you previously hid from the dashboard.',
  },
]

export default function SettingsHubPage() {
  return (
    <div className="max-w-[720px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Configure LucidIndex — pick a panel to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PANELS.map((panel) => (
          <Link key={panel.href} href={panel.href} className="group block">
            <Card className="h-full transition-colors hover:border-foreground/30">
              <CardHeader>
                <CardTitle className="text-base group-hover:underline underline-offset-4 decoration-2">
                  {panel.title}
                </CardTitle>
                <CardDescription>{panel.blurb}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
