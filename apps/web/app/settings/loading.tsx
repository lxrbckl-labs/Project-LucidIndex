/**
 * Generic settings skeleton — shown instantly on navigation into any
 * /settings/* route segment while the RSC page fetches data.
 *
 * Matches the `flex flex-1 flex-col gap-4 p-6` wrapper that layout.tsx
 * wraps every authenticated settings child in via SidebarInset.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      {/* Page title row */}
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96" />

      {/* Card placeholder 1 */}
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* Card placeholder 2 */}
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}
