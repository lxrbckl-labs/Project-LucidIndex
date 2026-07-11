'use client'

import { useEffect, useRef, useState } from 'react'
import { usePostsTOCVisibility } from '@/lib/posts-toc-visibility'

type Item = { id: string; title: string }

function smoothScrollToElement(el: HTMLElement, offsetTop: number, duration: number): void {
  const startY = window.scrollY
  const targetY = el.getBoundingClientRect().top + window.scrollY - offsetTop
  const distance = targetY - startY
  if (distance === 0) return
  let startTime: number | null = null
  function step(timestamp: number): void {
    if (startTime === null) startTime = timestamp
    const elapsed = timestamp - startTime
    const t = Math.min(elapsed / duration, 1)
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    window.scrollTo(0, startY + distance * eased)
    if (elapsed < duration) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function PostsTOC({ items }: { items: Item[] }) {
  const { visible } = usePostsTOCVisibility()
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  // Track currently-visible post ids in document order so we can always
  // highlight the first visible one (not just the last to trigger the
  // observer).
  const visibleIdsRef = useRef<Set<string>>(new Set())
  // Ref on the <ol> so we can find the active <li> and scroll it into view.
  const olRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    if (items.length === 0) return

    // Resolve which item should be highlighted from the current scroll
    // position + the set of visible ids.
    const recompute = () => {
      // Bottom-of-page short-circuit. Near the page bottom the final posts
      // all share the active band at once and the topmost one always wins,
      // so the last items could otherwise NEVER highlight — and the observer
      // goes quiet during that last stretch of scroll (nothing crosses a
      // threshold), so reaching the very bottom wouldn't update it either.
      // When we're at (or within a hair of) the bottom, the last item is the
      // one the reader is looking at.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      if (atBottom) {
        const last = items[items.length - 1]
        if (last) setActiveId(last.id)
        return
      }
      // Otherwise pick the FIRST item (in items-array order) currently in
      // the active band.
      const firstVisible = items.find((item) => visibleIdsRef.current.has(item.id))
      if (firstVisible) {
        setActiveId(firstVisible.id)
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rawId = entry.target.id // "post-<uuid>"
          const id = rawId.slice('post-'.length)
          if (entry.isIntersecting) {
            visibleIdsRef.current.add(id)
          } else {
            visibleIdsRef.current.delete(id)
          }
        }
        recompute()
      },
      {
        // Top inset: match the TopNav height (~68px) + padding so the card
        // title clears the sticky chrome before being counted as active.
        // Bottom -50%: only the upper half of the viewport counts as
        // "active" — the item scrolling into the lower half doesn't steal
        // the highlight until it reaches the top region.
        rootMargin: '-88px 0px -50% 0px',
        threshold: 0,
      },
    )

    for (const item of items) {
      const el = document.getElementById(`post-${item.id}`)
      if (el) observer.observe(el)
    }

    // The observer stops firing once the bottom posts are all on-screen, so
    // a scroll listener is what actually catches the bottom-of-page case.
    // rAF-throttled so it stays cheap during fast scrolls.
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        recompute()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [items])

  // Auto-scroll the TOC so the active item stays in the visible region of
  // the TOC's overflow container. `block: 'nearest'` is a no-op when the
  // item is already in view and scrolls smoothly only when it's not.
  useEffect(() => {
    if (!activeId) return
    const el = olRef.current?.querySelector<HTMLElement>(`[data-toc-item="${activeId}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  if (items.length === 0) return null

  return (
    <aside
      aria-label="Posts on this page"
      aria-hidden={!visible}
      data-state={visible ? 'open' : 'closed'}
      className="toc-clip hidden xl:block shrink-0 border-l transition-[width] duration-200 ease-linear data-[state=open]:w-72 data-[state=closed]:w-0 data-[state=closed]:border-l-0"
    >
      <nav className="no-scrollbar sticky top-[68px] max-h-[calc(100vh-68px)] overflow-y-auto">
        <ol ref={olRef} className="flex flex-col gap-1 px-3 pt-6 pb-3 text-sm">
          {items.map((item) => (
            <li key={item.id} data-toc-item={item.id}>
              <a
                href={`#post-${item.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  const el = document.getElementById(`post-${item.id}`)
                  if (el) {
                    smoothScrollToElement(el, 88, 800)
                    window.setTimeout(() => {
                      el.classList.add('toc-flash')
                      window.setTimeout(() => el.classList.remove('toc-flash'), 1400)
                    }, 700)
                  }
                  history.replaceState(null, '', `#post-${item.id}`)
                }}
                className={`block py-0.5 transition-all duration-200 ease-out ${
                  activeId === item.id
                    ? 'font-semibold text-foreground'
                    : 'font-normal text-muted-foreground hover:font-semibold hover:text-foreground'
                }`}
              >
                <span className="line-clamp-2 break-words">{item.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  )
}
