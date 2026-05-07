/**
 * /settings — the authenticated hub (Phase 2).
 *
 * Grouped grid of shadcn Cards mirroring the sidebar structure:
 *   Agents   — Targets, Comparison sources, Templates
 *   System   — System, Agent tokens
 *   Inbox    — Badges
 *   Account  — Account
 *
 * Layout: grid-cols-1 md:grid-cols-2 xl:grid-cols-3, gap-6
 * Each card: icon + title + description, full-card Link, hover lift.
 */

import { BookOpen, FileText, Key, Settings2, ShieldCheck, Tag, Ticket } from 'lucide-react'
import Link from 'next/link'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Panel = {
  href: string
  title: string
  blurb: string
  icon: React.ElementType
}

type Group = {
  label: string
  panels: Panel[]
}

const GROUPS: Group[] = [
  {
    label: 'Agents',
    panels: [
      {
        href: '/settings/targets',
        title: 'Targets',
        blurb: 'Sources the agent crawls — feeds, sites, and ingestion targets.',
        icon: Settings2,
      },
      {
        href: '/settings/comparison-sources',
        title: 'Comparison Sources',
        blurb: 'External sources used by the agent when comparing and rating articles.',
        icon: BookOpen,
      },
      {
        href: '/settings/templates',
        title: 'Templates',
        blurb: 'Prompt templates with Liquid validation and starter library.',
        icon: FileText,
      },
    ],
  },
  {
    label: 'System',
    panels: [
      {
        href: '/settings/system',
        title: 'System',
        blurb: 'Cron run history, queue depth, and drift histograms.',
        icon: Settings2,
      },
      {
        href: '/settings/agent-tokens',
        title: 'Agent Tokens',
        blurb: 'Issue, display once, hash, and revoke tokens for headless agents.',
        icon: Key,
      },
    ],
  },
  {
    label: 'Inbox',
    panels: [
      {
        href: '/settings/badges',
        title: 'Badges',
        blurb: 'Curated badges, agent-suggested badge inbox, and bulk actions.',
        icon: Tag,
      },
    ],
  },
  {
    label: 'Forum',
    panels: [
      {
        href: '/settings/forum-invites',
        title: 'Forum Invites',
        blurb: 'Generate single-use invite codes that gate forum signup.',
        icon: Ticket,
      },
    ],
  },
  {
    label: 'Account',
    panels: [
      {
        href: '/settings/account',
        title: 'Account',
        blurb: 'Registered passkeys, register another device, regenerate recovery code.',
        icon: ShieldCheck,
      },
    ],
  },
]

export default function SettingsHubPage() {
  return (
    <div className="max-w-[960px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Configure LucidIndex — pick a panel to get started.
        </p>
      </div>

      <div className="space-y-10">
        {GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {group.label}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {group.panels.map((panel) => {
                const Icon = panel.icon
                return (
                  <Link key={panel.href} href={panel.href} className="group block">
                    <Card className="h-full transition-colors hover:bg-accent/50 hover:shadow-sm">
                      <CardHeader>
                        <div className="mb-2 flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </div>
                        <CardTitle className="text-base font-semibold group-hover:underline underline-offset-4 decoration-2">
                          {panel.title}
                        </CardTitle>
                        <CardDescription className="text-sm text-muted-foreground">
                          {panel.blurb}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
