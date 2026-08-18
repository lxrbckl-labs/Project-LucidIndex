/**
 * Boolean env-var parser.
 *
 * Used by the LUCIDINDEX_SEED_DEMO toggle (and any future env-flag we want
 * the same semantics for). Truthy ↔ any of `true`, `1`, `yes`
 * (case-insensitive, trimmed). Everything else — `false`, `0`, `no`, the
 * empty string, undefined, garbage — is falsy.
 *
 * The deliberately-narrow truthy set keeps operator intent explicit in
 * docker-compose / `.env` files: "yes I want this" is a positive
 * statement, not the result of a typo.
 */
export function parseBoolEnv(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false
  const normalised = value.trim().toLowerCase()
  return normalised === 'true' || normalised === '1' || normalised === 'yes'
}
