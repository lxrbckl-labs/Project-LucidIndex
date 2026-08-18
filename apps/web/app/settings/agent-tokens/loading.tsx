/**
 * Agent Tokens page skeleton — header row → Separator → list of token rows.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = 4

export default function AgentTokensLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-4 w-[34rem]" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        {Array.from({ length: ROWS }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center justify-between gap-4 rounded-md border p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
