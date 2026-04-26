/**
 * /settings — the authenticated hub.
 *
 * Lists the eight sub-panels with a one-line description each, so an
 * admin landing on `/settings` for the first time sees what's behind
 * each link without having to click through. Real CRUD lives in the
 * sub-panels (Phase 2 / Phase 7).
 */

import Link from 'next/link'

const PANELS: ReadonlyArray<{ href: string; title: string; blurb: string; phase: string }> = [
  {
    href: '/settings/account',
    title: 'Account',
    blurb: 'Registered passkeys, register another device, regenerate recovery code.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/targets',
    title: 'Targets',
    blurb: 'Sources the agent crawls — feeds, sites, and ingestion targets.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/badges',
    title: 'Badges',
    blurb: 'Curated badges, agent-suggested badge inbox, and bulk actions.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/templates',
    title: 'Templates',
    blurb: 'Prompt templates with Liquid validation and starter library.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/agent-tokens',
    title: 'Agent tokens',
    blurb: 'Issue, display once, hash, and revoke tokens for headless agents.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/off-site-backup',
    title: 'Off-site backup',
    blurb: 'Configure the rclone remote that receives nightly DB dumps.',
    phase: 'Phase 2',
  },
  {
    href: '/settings/system',
    title: 'System',
    blurb: 'Cron run history, queue depth, and drift histograms.',
    phase: 'Phase 7',
  },
  {
    href: '/settings/hidden-articles',
    title: 'Hidden articles',
    blurb: 'List and restore articles you previously hid from the dashboard.',
    phase: 'Phase 7',
  },
]

export default function SettingsHubPage() {
  return (
    <div className="max-w-[680px]">
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Settings
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
      <p className="text-base text-neutral-600 leading-relaxed mb-12">
        Eight panels — pick one to configure. Phase 2 fills in the day-to-day controls; Phase 7 adds
        the operational read-outs.
      </p>

      <ul className="space-y-8">
        {PANELS.map((panel) => (
          <li key={panel.href}>
            <Link href={panel.href} className="group block">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold text-black group-hover:underline underline-offset-4 decoration-2">
                  {panel.title}
                </h2>
                <span className="text-xs uppercase tracking-wide text-neutral-400 shrink-0">
                  {panel.phase}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{panel.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
