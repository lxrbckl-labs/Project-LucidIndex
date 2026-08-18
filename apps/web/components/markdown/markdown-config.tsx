/**
 * Shared ReactMarkdown component map for every markdown surface.
 *
 * Environment-neutral (NO `'use client'` directive) so it can be imported
 * by server-rendered surfaces (forum `PostView` post body, the `/a/[slug]`
 * article deep-dive) AND the client-rendered `CommentBody` (reply body) —
 * they all reuse the exact same styling so markdown reads identically
 * whether it's a magazine article, a forum post, or a reply.
 *
 * Customizes:
 *  - `a` — external links (http(s) NOT on the current origin) open in a
 *    new tab with noopener/noreferrer. Internal links stay default.
 *    SSR doesn't know the origin reliably, so we treat any `http(s)://`
 *    href as external — internal app routes use relative hrefs.
 *  - `code` / `pre` — inline + fenced code get muted styling that picks
 *    up the surrounding theme tokens (no separate prose plugin).
 *  - `table` — wrapped in an overflow container so wide tables don't
 *    break the layout on narrow screens.
 */

import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const markdownComponents = {
  a({ href, children, ...rest }: ComponentPropsWithoutRef<'a'> & { children?: ReactNode }) {
    const h = typeof href === 'string' ? href : ''
    const isExternal = /^https?:\/\//i.test(h)
    if (isExternal) {
      return (
        <a
          {...rest}
          href={h}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {children}
        </a>
      )
    }
    return (
      <a {...rest} href={h} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </a>
    )
  },
  code({ children, ...rest }: ComponentPropsWithoutRef<'code'> & { children?: ReactNode }) {
    return (
      <code
        {...rest}
        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
      >
        {children}
      </code>
    )
  },
  pre({ children, ...rest }: ComponentPropsWithoutRef<'pre'> & { children?: ReactNode }) {
    return (
      <pre
        {...rest}
        className="my-3 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs"
      >
        {children}
      </pre>
    )
  },
  blockquote({
    children,
    ...rest
  }: ComponentPropsWithoutRef<'blockquote'> & { children?: ReactNode }) {
    return (
      <blockquote
        {...rest}
        className="my-3 border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground"
      >
        {children}
      </blockquote>
    )
  },
  table({ children, ...rest }: ComponentPropsWithoutRef<'table'> & { children?: ReactNode }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table {...rest} className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    )
  },
  th({ children, ...rest }: ComponentPropsWithoutRef<'th'> & { children?: ReactNode }) {
    return (
      <th {...rest} className="border-b px-2 py-1 text-left font-semibold">
        {children}
      </th>
    )
  },
  td({ children, ...rest }: ComponentPropsWithoutRef<'td'> & { children?: ReactNode }) {
    return (
      <td {...rest} className="border-b px-2 py-1">
        {children}
      </td>
    )
  },
  p({ children, ...rest }: ComponentPropsWithoutRef<'p'> & { children?: ReactNode }) {
    return (
      <p {...rest} className="text-justify">
        {children}
      </p>
    )
  },
  ul({ children, ...rest }: ComponentPropsWithoutRef<'ul'> & { children?: ReactNode }) {
    return (
      <ul {...rest} className="my-2 list-disc pl-6">
        {children}
      </ul>
    )
  },
  ol({ children, ...rest }: ComponentPropsWithoutRef<'ol'> & { children?: ReactNode }) {
    return (
      <ol {...rest} className="my-2 list-decimal pl-6">
        {children}
      </ol>
    )
  },
  h1({ children, ...rest }: ComponentPropsWithoutRef<'h1'> & { children?: ReactNode }) {
    return (
      <h1 {...rest} className="mt-4 mb-2 text-2xl font-bold tracking-tight">
        {children}
      </h1>
    )
  },
  h2({ children, ...rest }: ComponentPropsWithoutRef<'h2'> & { children?: ReactNode }) {
    return (
      <h2 {...rest} className="mt-4 mb-2 text-xl font-semibold tracking-tight">
        {children}
      </h2>
    )
  },
  h3({ children, ...rest }: ComponentPropsWithoutRef<'h3'> & { children?: ReactNode }) {
    return (
      <h3 {...rest} className="mt-3 mb-1.5 text-lg font-semibold tracking-tight">
        {children}
      </h3>
    )
  },
}
