/**
 * Public surface of `@lucidindex/auth`.
 *
 * Server-side only. Importing from this entry point pulls in `next/headers`,
 * `iron-session`, and `@simplewebauthn/server` — none of which belong in a
 * client bundle. React components live behind the `./react` entry instead.
 */

export {
  type FinalizeFoundingSessionResult,
  type FinishFoundingEnrollmentInput,
  type FinishFoundingEnrollmentResult,
  finalizeFoundingSession,
  finishFoundingEnrollment,
  isFoundingFlowAvailable,
  makeDrizzleFoundingStore,
  type StartFoundingEnrollmentResult,
  startFoundingEnrollment,
} from './found.js'
export {
  type FoundFirstAdminFailure,
  type FoundFirstAdminInput,
  type FoundFirstAdminResult,
  type FoundingCredential,
  type FoundingPreCheck,
  type FoundingStore,
  foundFirstAdmin,
  isAdminsTableEmpty,
} from './found-core.js'
export {
  type FinishLoginInput,
  type FinishLoginResult,
  finishLogin,
  type StartLoginResult,
  startLogin,
} from './login.js'
export {
  generatePlaintextCode,
  hashCode,
  verifyHash,
} from './recovery.js'
export {
  destroySession,
  establishSession,
  getSession,
  requireAdmin,
  SESSION_COOKIE_NAME,
  type SessionData,
} from './session.js'
export { getRelyingParty, type RelyingParty } from './webauthn.js'
