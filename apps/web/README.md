# `@lucidindex/web` — local dev notes

Operational notes specific to the Next.js dashboard. The repo-root
`README.md` covers the full-stack story; this file is for app-local
quirks that don't belong there.

## Running with mock articles

The Phase 5 visual foundation (`#56`–`#62`) ships a mock-article
loader so the dashboard masonry, card components, and large-variant
overlay can be exercised without a live Postgres or any agent runs.
This is what the Phase 5 visual gate (`#63`) screenshots against.

```sh
LUCIDINDEX_MOCK=1 pnpm --filter @lucidindex/web dev
```

What the flag does:

- `app/page.tsx` skips the session check (no `IRON_SESSION_PASSWORD`
  is required for mock mode).
- `loadDashboardArticles()` returns the 12 fixture articles in
  `app/_mock/articles.ts` instead of reading from the DB.
- Hero images come from `picsum.photos` seeded URLs with
  `?grayscale=1` to match the Fyrre reference.

The flag is read at request time. Clear it (or restart `next dev`
without it) to return to real-DB mode.

## Phase 5 visual gate (#63) — taking the side-by-side screenshot

The acceptance test for Phase 5 is "drop our dashboard next to
`<vault>/Projects/Project-LucidIndex/Design/main.jpg` — does the
visual family read the same?"

To capture:

1. `LUCIDINDEX_MOCK=1 pnpm --filter @lucidindex/web dev`
2. Open `http://localhost:47892` in a 1440px-wide window.
3. Take a full-page screenshot (browser dev tools' "capture
   full-size screenshot" or Playwright's `page.screenshot({ fullPage: true })`).
4. Save under `tests/screenshots/phase5-foundation-<n>.png`. The
   `tests/screenshots/` directory is gitignored — paste the image
   directly into PR / issue bodies, don't commit it.

Recommended minimum capture set for the gate:

- Full dashboard at 1440px with the masonry visible.
- Close-up of one standard `ArticleCard`.
- Close-up of one `LargeArticleCard`.
- Empty state (run with `LUCIDINDEX_MOCK` unset and no DB session).

## Authenticated dashboard vs. public landing

`/` renders two different views depending on session state:

- No session → the Phase 1 public empty state (locked copy:
  "Nothing has been filed yet."). The founding-admin e2e asserts
  this verbatim, so don't drift the copy without updating the test.
- Authenticated admin → the masonry dashboard, with `AuthenticatedEmptyState`
  shown when the article list is empty. The empty state pitches
  Settings → Targets so the admin can configure their first creator.
