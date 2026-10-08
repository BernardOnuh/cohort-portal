// V2 first-login onboarding rules — pure functions, unit-tested in tests/onboarding.test.js

export const EARLY_BIRD_SLOTS = 10
export const EARLY_BIRD_BONUS = 200
export const STANDARD_BONUS = 150
export const FIRST_TEST_DELAY_MS = 24 * 60 * 60 * 1000

/** Bonus for the student who completed their profile at 0-based position `rank` in their intake. */
export function profileBonusFor(rank) {
  return rank < EARLY_BIRD_SLOTS ? EARLY_BIRD_BONUS : STANDARD_BONUS
}

/** When a student's first test unlocks; null until they finish onboarding. */
export function firstTestUnlocksAt(onboardedAt) {
  if (!onboardedAt) return null
  return new Date(new Date(onboardedAt).getTime() + FIRST_TEST_DELAY_MS)
}

/**
 * Whether a student may open/submit a test right now.
 * Only the *first* test is gated: it needs onboarding finished + 24h elapsed.
 */
export function firstTestGate({ onboardedAt, attempts }, now = new Date()) {
  if (attempts > 0) return { ok: true }
  if (!onboardedAt) return { ok: false, reason: 'Finish your welcome tour first', unlocksAt: null }
  const unlocksAt = firstTestUnlocksAt(onboardedAt)
  if (now < unlocksAt) return { ok: false, reason: 'Your Knowledge Check unlocks 24 hours after you join', unlocksAt }
  return { ok: true }
}

/** Ordering key for leaderboard ties: whoever earned points first wins. */
export function firstEarnedAt(firstAttemptAt, profileCompletedAt) {
  const times = [firstAttemptAt, profileCompletedAt].filter(Boolean).map(d => new Date(d).getTime())
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY
}

export const INVITE_TASK = 'INVITE_FRIENDS'
export const INVITE_POINTS = 100

export const GENDERS = ['MALE', 'FEMALE']
export function normalizeGender(raw) {
  const v = String(raw ?? '').trim().toUpperCase()
  return GENDERS.includes(v) ? v : null
}

/** Latest proof decides the task state: APPROVED is final; PENDING blocks resubmits; REJECTED allows a new one. */
export function inviteTaskState(proofs) {
  if (proofs.some(p => p.status === 'APPROVED')) return 'APPROVED'
  const latest = [...proofs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
  return latest?.status ?? 'NOT_STARTED'
}
