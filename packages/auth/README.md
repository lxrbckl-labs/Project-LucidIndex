# @lucidindex/auth

WebAuthn passkey + iron-session auth for the single-admin LucidIndex shell.

Ported from [Project-Showalter](https://github.com/lxrbckl-dev/Project-Showalter)'s
`src/features/auth/` modules — Showalter is a sibling repo Alex already runs
with the same passkey-only / single-admin / one-recovery-code design, so this
package is largely a translation rather than a fresh write.

## What's in here

### Server (default entry — `@lucidindex/auth`)

- `getSession()`, `requireAdmin()`, `establishSession()`, `destroySession()`
  — iron-session helpers. `IRON_SESSION_PASSWORD` (32+ chars) must be set.
- `getRelyingParty()` — reads `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN` (defaults
  to `localhost` + `http://localhost:3000` for dev).
- `startFoundingEnrollment()`, `finishFoundingEnrollment()`,
  `finalizeFoundingSession()` — three-step founding-admin ceremony.
- `startLogin()`, `finishLogin()` — two-step passkey login.
- `foundFirstAdmin()`, `isAdminsTableEmpty()`, `FoundingStore`,
  `FoundingPreCheck` — pure core logic with an injectable store. Used by
  `found.ts` against Drizzle and by the unit tests against an in-memory fake.
- `generatePlaintextCode()`, `hashCode()`, `verifyHash()` — recovery-code
  primitives (argon2id via `@node-rs/argon2`).

### React (`@lucidindex/auth/react`)

- `LoginForm` — passkey login, no email field (single-admin).
- `FoundingAdminForm` — claim the founding admin slot. Renders a recovery-
  code modal before minting the session (mirrors Showalter — see the
  comment block in `FoundingAdminForm.tsx` for why).

Both forms take server actions as props rather than importing them from a
hard-coded path, so apps/web can wrap `startLogin` / `finishLogin` / etc.
with whatever rate limiting + challenge storage they need.

## Adaptations from Showalter

Documented inline in each file's header comment. Summary:

| Showalter | LucidIndex | Reason |
|-----------|-----------|--------|
| better-sqlite3 + sync transactions | postgres-js + async transactions | LucidIndex stack |
| `admins.email` keys lookups | single admin, no email column | LucidIndex schema is leaner |
| Auth.js `users`/`sessions` tables | iron-session cookie | ticket spec, fewer moving parts |
| `bcryptjs` for recovery codes | `@node-rs/argon2` (argon2id) | OWASP-recommended modern KDF |
| RP derived from `BASE_URL` | `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN` | RP independent of app URL |
| In-package challenge store + rate limiter | left to the consuming app | not auth-package's concern |
| `'use server'` server actions | plain async functions | consumer wraps with `'use server'` |

## Founding-token seam (#27)

`foundFirstAdmin` accepts an optional `preCheck` hook that runs inside the
transaction, after the empty-admins check and before any insert. Ticket #27
will pass a hook here that hashes the supplied token and compares it to
`LUCIDINDEX_FOUNDING_TOKEN` from env. This package does NOT implement the
env-var check itself — it just exposes the seam.

## Required env vars

```
IRON_SESSION_PASSWORD=<32+ char hex>     # generate with: openssl rand -hex 32
WEBAUTHN_RP_ID=localhost                 # production: your domain
WEBAUTHN_ORIGIN=http://localhost:3000    # production: https://yourdomain
```

`LUCIDINDEX_FOUNDING_TOKEN` is added by #27 and consumed via the `preCheck`
hook above.

## Tests

```
pnpm --filter @lucidindex/auth test
```

Tests cover the pure `found-core` logic (transaction rollback, race-loser
handling, `preCheck` semantics). They use an in-memory `FoundingStore` fake
so no Postgres is required.

## Source

Showalter modules this package was ported from:

- `src/features/auth/found-core.ts` (+ `.test.ts`)
- `src/features/auth/found.ts`
- `src/features/auth/login.ts`
- `src/features/auth/recovery.ts`
- `src/features/auth/relying-party.ts`
- `src/features/auth/auth.ts` (session manager — replaced with iron-session)
- `src/app/(admin)/admin/login/LoginForm.tsx`
- `src/app/(admin)/admin/login/FoundingAdminForm.tsx`
