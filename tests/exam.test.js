import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_GRACE_MS,
  advanceExpired,
  secondsLeft,
  normalizeChoice,
  socialPlatform,
  isWebUrl,
  certificateCode,
  examStage,
} from '../src/services/v2-exam.js'

const t0 = new Date('2026-10-22T10:00:00Z')
const at = ms => new Date(t0.getTime() + ms)

test('advanceExpired: inside the window (plus grace) stays on the same question', () => {
  const s = advanceExpired({ currentIndex: 2, questionStartedAt: t0 }, 10, 30, at(30_000 + ANSWER_GRACE_MS))
  assert.equal(s.currentIndex, 2)
  assert.equal(s.questionStartedAt.getTime(), t0.getTime())
})

test('advanceExpired: the clock keeps running while the tab is closed', () => {
  // 75s away: Q0 ran out at 30s, Q1 at 60s, now 15s into Q2
  const s = advanceExpired({ currentIndex: 0, questionStartedAt: t0 }, 10, 30, at(75_000))
  assert.equal(s.currentIndex, 2)
  assert.equal(s.questionStartedAt.getTime(), at(60_000).getTime())
})

test('advanceExpired: never goes past the last question', () => {
  const s = advanceExpired({ currentIndex: 0, questionStartedAt: t0 }, 3, 30, at(3_600_000))
  assert.equal(s.currentIndex, 3)
})

test('secondsLeft: counts down and floors at 0', () => {
  assert.equal(secondsLeft(t0, 30, at(0)), 30)
  assert.equal(secondsLeft(t0, 30, at(12_500)), 18)
  assert.equal(secondsLeft(t0, 30, at(40_000)), 0)
})

test('normalizeChoice: letters within range, null for a timeout', () => {
  assert.deepEqual(normalizeChoice('b', 4), { ok: true, value: 'B' })
  assert.deepEqual(normalizeChoice(null, 4), { ok: true, value: null })
  assert.equal(normalizeChoice('E', 4).ok, false)
  assert.equal(normalizeChoice('AB', 4).ok, false)
})

test('socialPlatform: X, Instagram and TikTok posts only', () => {
  assert.equal(socialPlatform('https://x.com/ada/status/1849'), 'X')
  assert.equal(socialPlatform('https://twitter.com/ada/status/1849'), 'X')
  assert.equal(socialPlatform('https://www.instagram.com/p/C1abc/'), 'INSTAGRAM')
  assert.equal(socialPlatform('https://vm.tiktok.com/ZMabc/'), 'TIKTOK')
  assert.equal(socialPlatform('https://www.tiktok.com/@ada/video/7311'), 'TIKTOK')
  assert.equal(socialPlatform('https://x.com/'), null)
  assert.equal(socialPlatform('https://facebook.com/post/1'), null)
  assert.equal(socialPlatform('https://x.com.evil.io/status/1'), null)
  assert.equal(socialPlatform('not a url'), null)
})

test('isWebUrl: accepts http(s) links only', () => {
  assert.equal(isWebUrl('https://www.figma.com/design/abc'), true)
  assert.equal(isWebUrl('javascript:alert(1)'), false)
  assert.equal(isWebUrl('figma'), false)
})

test('certificateCode: W3N-XXXX-XXXX from an unambiguous alphabet', () => {
  assert.match(certificateCode(), /^W3N-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.equal(certificateCode(Buffer.alloc(8)), 'W3N-AAAA-AAAA')
})

test('examStage: earn = yes → join group → certificate → bootcamp', () => {
  const base = { mcqDoneAt: t0, practicalAt: t0, wantsToEarn: null, joinedGroupAt: null, wantsCertificate: null, certificateCode: null }
  assert.equal(examStage(null), 'NOT_STARTED')
  assert.equal(examStage({ ...base, mcqDoneAt: null }), 'MCQ')
  assert.equal(examStage({ ...base, practicalAt: null }), 'PRACTICAL')
  assert.equal(examStage(base), 'ASK_EARN')
  assert.equal(examStage({ ...base, wantsToEarn: true }), 'JOIN_GROUP')
  assert.equal(examStage({ ...base, wantsToEarn: true, joinedGroupAt: t0 }), 'CERTIFICATE')
  assert.equal(examStage({ ...base, wantsToEarn: true, joinedGroupAt: t0, certificateCode: 'W3N-AAAA-AAAA' }), 'BOOTCAMP')
})

test('examStage: earn = no → optional certificate → bootcamp', () => {
  const base = { mcqDoneAt: t0, practicalAt: t0, wantsToEarn: false, joinedGroupAt: null, wantsCertificate: null, certificateCode: null }
  assert.equal(examStage(base), 'ASK_CERTIFICATE')
  assert.equal(examStage({ ...base, wantsCertificate: true }), 'CERTIFICATE')
  assert.equal(examStage({ ...base, wantsCertificate: true, certificateCode: 'W3N-AAAA-AAAA' }), 'BOOTCAMP')
  assert.equal(examStage({ ...base, wantsCertificate: false }), 'BOOTCAMP')
})
