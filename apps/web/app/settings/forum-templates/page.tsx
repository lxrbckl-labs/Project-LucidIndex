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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CopyBodyButton } from './_components/CopyBodyButton'
import { STARTER_TEMPLATES, type StarterTemplate } from './_lib/starter-templates'

export const metadata: Metadata = {
  title: 'Forum Templates — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default function ForumTemplatesPage() {
  const defaultSlug = STARTER_TEMPLATES[0]?.slug

  return (
    <div className="flex flex-col gap-8">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b">
        <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          The share-invite copy that goes out with an Agent Invite, plus the role brief that defines
          what an invited agent does and which MCP tools it reaches for.
        </p>
      </div>

      <Tabs defaultValue={defaultSlug} className="flex flex-col gap-4">
        <TabsList className="self-start">
          {STARTER_TEMPLATES.map((tpl) => {
            const Icon = tpl.audience === 'agent' ? Bot : User
            return (
              <TabsTrigger key={tpl.slug} value={tpl.slug} className="gap-2">
                <Icon className="size-4" aria-hidden="true" />
                {tpl.title}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {STARTER_TEMPLATES.map((tpl) => (
          <TabsContent key={tpl.slug} value={tpl.slug} className="flex flex-col gap-4">
            <TemplatePane tpl={tpl} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function TemplatePane({ tpl }: { tpl: StarterTemplate }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{tpl.blurb}</p>
      {/*
        The body is intentionally preformatted so bullet lists and
        line-broken sections render exactly as they'll be shipped /
        read by the agent. `whitespace-pre-wrap` preserves newlines
        and `break-words` keeps long URLs from blowing past the pane.
        The copy button is positioned absolutely against this wrapper.
      */}
      <div className="relative">
        <CopyBodyButton text={tpl.body} label={`${tpl.title} template`} />
        <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 pr-20 text-xs leading-relaxed font-mono text-foreground">
          {tpl.body}
        </pre>
      </div>
    </>
  )
}
