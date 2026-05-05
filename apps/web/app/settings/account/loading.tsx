/**
 * Account page skeleton — header → Separator → 3 stacked sections
 * (Registered passkeys, Register a passkey, Recovery code) divided by Separators.
 */

import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const PASSKEYS = 2

export default function AccountLoading() {
  return (
    <div className="max-w-[640px] flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Separator />

      {/* Registered passkeys */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-col gap-2 border-y">
          {Array.from({ length: PASSKEYS }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
            <div key={i} className="flex items-center justify-between py-3 gap-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Register a passkey */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-[28rem]" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-9 w-40 self-start" />
      </div>

      <Separator />

      {/* Recovery code */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-[32rem]" />
        <Skeleton className="h-9 w-56 self-start" />
      </div>
    </div>
  )
}
