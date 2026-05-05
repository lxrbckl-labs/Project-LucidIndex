/**
 * Templates page skeleton — header row → Separator → table.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = 7

export default function TemplatesLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-[32rem]" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex gap-4 px-2 py-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: ROWS }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center gap-4 px-2 py-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 flex-1 max-w-[420px]" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
