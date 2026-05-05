/**
 * Comparison Sources page skeleton — header row → Separator → table.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = 5

export default function ComparisonSourcesLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-[28rem]" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex gap-4 px-2 py-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: ROWS }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center gap-4 px-2 py-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-4 flex-1 max-w-[140px]" />
            <Skeleton className="h-4 flex-1 max-w-[220px]" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 flex-1 max-w-[160px]" />
            <Skeleton className="h-8 flex-1 max-w-[100px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
