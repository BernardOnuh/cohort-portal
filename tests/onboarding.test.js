import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EARLY_BIRD_BONUS,
  STANDARD_BONUS,
  FIRST_TEST_DELAY_MS,
  profileBonusFor,
  firstTestUnlocksAt,
  firstTestGate,
  firstEarnedAt,
  normalizeGender,
  inviteTaskState,
} from '../src/services/v2-onboarding.js'

test('profileBonusFor: first 10 (ranks 0-9) get 200, the rest 150', () => {
  assert.equal(profileBonusFor(0), EARLY_BIRD_BONUS)
  assert.equal(profileBonusFor(9), EARLY_BIRD_BONUS)
  assert.equal(profileBonusFor(10), STANDARD_BONUS)
  assert.equal(profileBonusFor(238), STANDARD_BONUS)
})

test('firstTestUnlocksAt: 24h after onboarding, null before', () => {
  assert.equal(firstTestUnlocksAt(null), null)
  const t = new Date('2026-10-08T10:00:00Z')
  assert.equal(firstTestUnlocksAt(t).getTime(), t.getTime() + FIRST_TEST_DELAY_MS)
})

test('firstTestGate: blocks before onboarding and inside the 24h window', () => {
  const on = new Date('2026-10-08T10:00:00Z')
  assert.equal(firstTestGate({ onboardedAt: null, attempts: 0 }).ok, false)
  const early = firstTestGate({ onboardedAt: on, attempts: 0 }, new Date('2026-10-09T09:59:59Z'))
  assert.equal(early.ok, false)
  assert.equal(early.unlocksAt.toISOString(), '2026-10-09T10:00:00.000Z')
  assert.equal(firstTestGate({ onboardedAt: on, attempts: 0 }, new Date('2026-10-09T10:00:00Z')).ok, true)
})

test('firstTestGate: later tests are never gated', () => {
  assert.equal(firstTestGate({ onboardedAt: null, attempts: 1 }).ok, true)
})

test('firstEarnedAt: earliest of attempt / profile, Infinity when neither', () => {
  const a = new Date('2026-10-08T10:00:00Z')
  const b = new Date('2026-10-07T10:00:00Z')
  assert.equal(firstEarnedAt(a, b), b.getTime())
  assert.equal(firstEarnedAt(null, a), a.getTime())
  assert.equal(firstEarnedAt(null, null), Number.POSITIVE_INFINITY)
})

test('normalizeGender: accepts MALE/FEMALE in any case, rejects anything else', () => {
  assert.equal(normalizeGender('male'), 'MALE')
  assert.equal(normalizeGender(' Female '), 'FEMALE')
  assert.equal(normalizeGender('x'), null)
  assert.equal(normalizeGender(undefined), null)
})

test('inviteTaskState: approved is final, otherwise the latest proof wins', () => {
  const t = (s, d) => ({ status: s, createdAt: new Date(`2026-10-0${d}T00:00:00Z`) })
  assert.equal(inviteTaskState([]), 'NOT_STARTED')
  assert.equal(inviteTaskState([t('REJECTED', 1), t('PENDING', 2)]), 'PENDING')
  assert.equal(inviteTaskState([t('PENDING', 2), t('REJECTED', 3)]), 'REJECTED')
  assert.equal(inviteTaskState([t('APPROVED', 1), t('REJECTED', 3)]), 'APPROVED')
})
