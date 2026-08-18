/**
 * Targets page skeleton — header row (title + Add Target button) → Separator → table.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = 6

export default function TargetsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-[28rem]" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        {/* Table header */}
        <div className="flex gap-4 px-2 py-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        {/* Rows */}
        {Array.from({ length: ROWS }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center gap-4 px-2 py-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-4 flex-1 max-w-[120px]" />
            <Skeleton className="h-4 flex-1 max-w-[200px]" />
            <Skeleton className="h-4 flex-1 max-w-[100px]" />
            <Skeleton className="h-4 flex-1 max-w-[100px]" />
            <Skeleton className="h-4 flex-1 max-w-[60px]" />
            <Skeleton className="h-8 flex-1 max-w-[120px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
