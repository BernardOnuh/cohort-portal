import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStudentName,
  validatePassword,
  validateExpectation,
  normalizeCategory,
  materialTypeFromMime,
  placeholderEmail,
  selectIntakeCohort,
  publicUser,
} from '../src/services/v2-identity.js'

// ── normalizeStudentName ─────────────────────────────────────────────────────

test('normalizeStudentName: trims and lowercases', () => {
  assert.deepEqual(normalizeStudentName('  Ada.Lovelace  '), { ok: true, value: 'ada.lovelace' })
})

test('normalizeStudentName: accepts digits, dot and underscore', () => {
  for (const name of ['abc123', 'a_b_c', 'ada.lovelace', '0day']) {
    assert.equal(normalizeStudentName(name).ok, true, name)
  }
})

test('normalizeStudentName: rejects empty, short and long values', () => {
  assert.equal(normalizeStudentName('').ok, false)
  assert.equal(normalizeStudentName('   ').ok, false)
  assert.equal(normalizeStudentName('ab').ok, false)
  assert.equal(normalizeStudentName('a'.repeat(31)).ok, false)
  assert.equal(normalizeStudentName(undefined).ok, false)
})

test('normalizeStudentName: rejects illegal characters', () => {
  for (const name of ['ada lovelace', 'ada@web3', 'ada!', '-ada', '.ada', '_ada']) {
    assert.equal(normalizeStudentName(name).ok, false, name)
  }
})

// ── validatePassword / validateExpectation ───────────────────────────────────

test('validatePassword: enforces 6-72 chars', () => {
  assert.equal(validatePassword('12345').ok, false)
  assert.equal(validatePassword('123456').ok, true)
  assert.equal(validatePassword('x'.repeat(72)).ok, true)
  assert.equal(validatePassword('x'.repeat(73)).ok, false)
  assert.equal(validatePassword(undefined).ok, false)
})

test('validateExpectation: enforces 10-600 chars and trims', () => {
  assert.equal(validateExpectation('too short').ok, false)
  const ok = validateExpectation('  I want to build dApps  ')
  assert.equal(ok.ok, true)
  assert.equal(ok.value, 'I want to build dApps')
  assert.equal(validateExpectation('x'.repeat(601)).ok, false)
})

// ── category + material type ─────────────────────────────────────────────────

test('normalizeCategory: defaults to MATERIAL, uppercases, rejects others', () => {
  assert.deepEqual(normalizeCategory(undefined), { ok: true, value: 'MATERIAL' })
  assert.deepEqual(normalizeCategory('recording'), { ok: true, value: 'RECORDING' })
  assert.deepEqual(normalizeCategory(' MATERIAL '), { ok: true, value: 'MATERIAL' })
  assert.equal(normalizeCategory('video').ok, false)
})

test('materialTypeFromMime: maps common upload mimetypes', () => {
  assert.equal(materialTypeFromMime('video/mp4'), 'video')
  assert.equal(materialTypeFromMime('video/webm; codecs=vp9'), 'video')
  assert.equal(materialTypeFromMime('application/pdf'), 'pdf')
  assert.equal(materialTypeFromMime('image/png'), 'image')
  assert.equal(materialTypeFromMime('audio/mpeg'), 'audio')
  assert.equal(materialTypeFromMime('text/csv'), 'csv')
  assert.equal(materialTypeFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'doc')
  assert.equal(materialTypeFromMime('application/octet-stream'), 'file')
  assert.equal(materialTypeFromMime(''), 'file')
})

// ── placeholderEmail ─────────────────────────────────────────────────────────

test('placeholderEmail: keeps V1 email NOT NULL satisfied', () => {
  assert.equal(placeholderEmail('ada.lovelace'), 'ada.lovelace@students.web3nova.app')
})

// ── selectIntakeCohort ───────────────────────────────────────────────────────

const cohort = (id, startDate, endDate) => ({ id, startDate, endDate })

test('selectIntakeCohort: returns null for no cohorts', () => {
  assert.equal(selectIntakeCohort([]), null)
  assert.equal(selectIntakeCohort(undefined), null)
})

test('selectIntakeCohort: picks the running cohort', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const running = cohort('c-running', '2026-09-01', '2026-12-01')
  const result = selectIntakeCohort([
    cohort('c-past', '2026-01-01', '2026-03-01'),
    running,
    cohort('c-future', '2027-01-01', '2027-04-01'),
  ], now)
  assert.equal(result.id, 'c-running')
})

test('selectIntakeCohort: with two running cohorts picks the later start', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const result = selectIntakeCohort([
    cohort('c-old', '2026-06-01', '2026-12-31'),
    cohort('c-new', '2026-09-15', '2026-12-31'),
  ], now)
  assert.equal(result.id, 'c-new')
})

test('selectIntakeCohort: when nothing is running, picks the next upcoming', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const result = selectIntakeCohort([
    cohort('c-far', '2027-06-01', '2027-09-01'),
    cohort('c-soon', '2027-01-05', '2027-04-01'),
    cohort('c-past', '2026-01-01', '2026-03-01'),
  ], now)
  assert.equal(result.id, 'c-soon')
})

test('selectIntakeCohort: when all are past, picks the most recent', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const result = selectIntakeCohort([
    cohort('c-1', '2025-01-01', '2025-04-01'),
    cohort('c-2', '2026-01-01', '2026-04-01'),
    cohort('c-3', '2024-01-01', '2024-04-01'),
  ], now)
  assert.equal(result.id, 'c-2')
})

// ── publicUser ───────────────────────────────────────────────────────────────

test('publicUser: never leaks the password hash', () => {
  const user = {
    id: 'u1', name: 'Ada', studentName: 'ada.lovelace', email: 'ada@x.dev',
    password: '$2b$10$hash', role: 'STUDENT', points: 40, expectation: 'Ship a dApp',
    imageUrl: 'https://res.cloudinary.com/x/avatar.png', cohortId: 'c1', courseId: 'k1',
    createdAt: new Date('2026-10-07'),
  }
  const out = publicUser(user)
  assert.equal(out.password, undefined)
  assert.equal(out.points, 40)
  assert.equal(out.studentName, 'ada.lovelace')
  assert.equal(publicUser(null), null)
})
