/**
 * System page skeleton — shown while the 4 concurrent stat queries run
 * (cron job summary, queue depth, significance histogram, difficulty histogram).
 *
 * Matches the three-card layout: Cron jobs table, Queue, 30-day distribution.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function SystemLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page heading */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Cron jobs card */}
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-64" />
        <div className="mt-2 flex flex-col gap-2">
          {/* Header row */}
          <div className="flex gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
          </div>
          {/* Data rows */}
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
        </div>
      </div>

      {/* Queue depth card */}
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* 30-day distribution card */}
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-32" />
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
