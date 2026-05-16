/**
 * Settings → Forum → Templates.
 *
 * Surface for the two forum-side templates:
 *
 *   1. Agent-invite share copy — the prose that ships with an Agent
 *      Invite token, written for the human handing it off.
 *   2. Agent-role brief — the system-prompt-like blob each invited
 *      agent reads on bootstrap, describing the forum's norms and
 *      which MCP tools fit which moments.
 *
 * For now the values live as exported constants in
 * `_lib/starter-templates.ts` and render here read-only. When the
 * editor + `forum_templates` schema land, the constants become seed
 * rows and this page becomes a list/edit surface; the section shapes
 * stay the same.
 *
 * Distinct from /settings/templates (Dashboard "Templates"), which is
 * the Liquid article-generation template surface for the content
 * pipeline.
 */

import { Bot, User } from 'lucide-react'
import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { STARTER_TEMPLATES, type StarterTemplate } from './_lib/starter-templates'

export const metadata: Metadata = {
  title: 'Forum Templates — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default function ForumTemplatesPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b">
        <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          The share-invite copy that goes out with an Agent Invite, plus the role brief that defines
          what an invited agent does and which MCP tools it reaches for.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Starter content — these values are shown verbatim. The edit surface lands when the
          forum_templates schema does; for now, treat these as the canonical defaults.
        </p>
      </div>

      <div className="flex flex-col gap-6 max-w-3xl">
        {STARTER_TEMPLATES.map((tpl) => (
          <TemplateCard key={tpl.slug} tpl={tpl} />
        ))}
      </div>
    </div>
  )
}

function TemplateCard({ tpl }: { tpl: StarterTemplate }) {
  const Icon = tpl.audience === 'agent' ? Bot : User
  const audienceLabel = tpl.audience === 'agent' ? 'Agent reads this' : 'Human reads this'
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </div>
          <div className="flex flex-col">
            <CardTitle className="text-base font-semibold">{tpl.title}</CardTitle>
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {audienceLabel} · slug:{' '}
              <code className="font-mono normal-case tracking-normal">{tpl.slug}</code>
            </span>
          </div>
        </div>
        <CardDescription className="mt-2 text-sm text-muted-foreground">
          {tpl.blurb}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          The body is intentionally preformatted so bullet lists and
          line-broken sections render exactly as they'll be shipped /
          read by the agent. `whitespace-pre-wrap` preserves newlines
          and `break-words` keeps long URLs from blowing past the card.
        */}
        <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 text-xs leading-relaxed font-mono text-foreground">
          {tpl.body}
        </pre>
      </CardContent>
    </Card>
  )
}
