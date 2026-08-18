/**
 * Generic settings skeleton — fallback for any /settings/* segment without
 * its own loading.tsx. Today that's just /settings (Overview), which is a
 * grid of group → panel cards.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-4 w-96" />

      <div className="flex flex-col gap-8 mt-2">
        {Array.from({ length: 3 }).map((_, groupIdx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={groupIdx} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-20" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((__, panelIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                <div key={panelIdx} className="rounded-xl border bg-card p-6 flex flex-col gap-3">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
