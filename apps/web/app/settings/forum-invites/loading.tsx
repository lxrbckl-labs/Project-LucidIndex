/**
 * Forum Invites page skeleton — header row → Separator → table.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = 4

export default function ForumInvitesLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-4 w-[34rem]" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-4 px-2 py-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          {Array.from({ length: ROWS }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <div key={i} className="flex gap-4 px-2 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
