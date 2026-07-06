/**
 * System page skeleton — flat layout (no Cards) matching page.tsx:
 *   header → Cron jobs section → Separator → Queue section
 *   → Separator → 30-day distribution section.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const CRON_ROWS = 4
const QUEUE_ROWS = 4

export default function SystemLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Cron jobs */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-col gap-2">
          {/* header row */}
          <div className="flex gap-4 px-2 py-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
          </div>
          {Array.from({ length: CRON_ROWS }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <div key={i} className="flex gap-4 px-2 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Queue */}
      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-4 w-56" />
        <div className="flex flex-col gap-2">
          <div className="flex gap-4 px-2 py-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          {Array.from({ length: QUEUE_ROWS }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <div key={i} className="flex items-center gap-4 px-2 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* 30-day distribution */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
