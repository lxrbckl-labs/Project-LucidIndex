/**
 * The LucidIndex mark used on the auth surfaces (login + recover), wrapped in a
 * home link so it doubles as a way back to the public dashboard. Light/dark
 * variants mirror the TopNav treatment.
 */

import Link from 'next/link'

export function AuthHomeMark() {
  return (
    <Link
      href="/"
      aria-label="Back to LucidIndex home"
      className="shrink-0 rounded-sm transition-opacity hover:opacity-80"
    >
      <img src="/logo-light.png" alt="" className="size-12 rounded-sm dark:hidden" />
      <img src="/logo-dark.png" alt="" className="hidden size-12 rounded-sm dark:block" />
    </Link>
  )
}
