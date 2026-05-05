/**
 * Badges page skeleton — header row → Separator → curated badges table → Separator → suggestion inbox.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const CURATED_ROWS = 6
const SUGGESTION_ROWS = 3

export default function BadgesLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <Separator />

      {/* Curated badges table */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-4 px-2 py-2">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: CURATED_ROWS }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center gap-4 px-2 py-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-4 flex-1 max-w-[160px]" />
            <Skeleton className="h-4 flex-1 max-w-[140px]" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>

      <Separator />

      {/* Suggestion inbox */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-[28rem]" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: SUGGESTION_ROWS }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="h-4 w-4" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
