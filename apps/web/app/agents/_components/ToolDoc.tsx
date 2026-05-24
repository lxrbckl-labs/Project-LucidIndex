/**
 * ToolDoc — renders one MCP tool's documentation block.
 *
 * Heading (mono tool name) + human-friendly title + verbatim description +
 * parameter table (or "No parameters.") + a single-line "Returns" note.
 *
 * Server component — fully static, no client hooks. Driven entirely by
 * the in-repo tool catalog (`_lib/tool-catalog.ts`); see that file for
 * the contract.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ToolEntry } from '../_lib/tool-catalog'

export function ToolDoc({ tool }: { tool: ToolEntry }) {
  return (
    <section id={tool.name} className="scroll-mt-24" aria-labelledby={`tool-${tool.name}-heading`}>
      <div className="flex flex-col gap-1">
        <h3
          id={`tool-${tool.name}-heading`}
          className="font-mono text-lg font-semibold tracking-tight"
        >
          {tool.name}
        </h3>
        <p className="text-sm text-muted-foreground">{tool.title}</p>
      </div>

      <p className="mt-3 text-sm leading-relaxed">{tool.description}</p>

      {tool.parameters === null ? (
        <p className="mt-4 text-sm text-muted-foreground italic">No parameters.</p>
      ) : (
        <div className="mt-4 rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">Name</TableHead>
                <TableHead className="w-[20%]">Type</TableHead>
                <TableHead className="w-[12%]">Required</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tool.parameters.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-mono text-xs align-top">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs align-top">{p.type}</TableCell>
                  <TableCell className="text-xs align-top">{p.required ? 'yes' : 'no'}</TableCell>
                  <TableCell className="text-sm align-top leading-relaxed">
                    {p.description || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-4 text-sm leading-relaxed">
        <span className="font-semibold">Returns:</span>{' '}
        <span className="text-muted-foreground">{tool.returns}</span>
      </p>
    </section>
  )
}
