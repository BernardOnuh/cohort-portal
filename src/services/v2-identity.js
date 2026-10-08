const STUDENT_NAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/

export const MIN_PASSWORD = 6
export const MAX_PASSWORD = 72
export const MIN_EXPECTATION = 10
export const MAX_EXPECTATION = 600

export function normalizeStudentName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'studentName required' }
  const value = raw.trim().toLowerCase()
  if (!value) return { ok: false, error: 'studentName required' }
  if (!STUDENT_NAME_RE.test(value)) {
    return {
      ok: false,
      error: 'studentName must be 3-30 chars: lowercase letters, numbers, dot or underscore, starting with a letter or number',
    }
  }
  return { ok: true, value }
}

export function validatePassword(raw) {
  if (typeof raw !== 'string' || !raw) return { ok: false, error: 'password required' }
  if (raw.length < MIN_PASSWORD) return { ok: false, error: `password must be at least ${MIN_PASSWORD} characters` }
  if (raw.length > MAX_PASSWORD) return { ok: false, error: `password must be at most ${MAX_PASSWORD} characters` }
  return { ok: true, value: raw }
}

export function validateExpectation(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'expectation required' }
  const value = raw.trim()
  if (value.length < MIN_EXPECTATION) return { ok: false, error: `expectation must be at least ${MIN_EXPECTATION} characters` }
  if (value.length > MAX_EXPECTATION) return { ok: false, error: `expectation must be at most ${MAX_EXPECTATION} characters` }
  return { ok: true, value }
}

// V1 keeps email NOT NULL, so V2 register falls back to a generated placeholder.
export function placeholderEmail(studentName) {
  return `${studentName}@students.web3nova.app`
}

export function normalizeCategory(raw) {
  const value = String(raw || 'MATERIAL').trim().toUpperCase()
  if (value !== 'MATERIAL' && value !== 'RECORDING') {
    return { ok: false, error: 'category must be MATERIAL or RECORDING' }
  }
  return { ok: true, value }
}

export function materialTypeFromMime(mime = '') {
  const m = mime.toLowerCase()
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (m.includes('sheet') || m === 'text/csv') return 'csv'
  if (m.includes('presentation') || m.includes('powerpoint')) return 'slides'
  if (m.includes('word') || m.includes('msword') || m.includes('opendocument.text')) return 'doc'
  if (m.startsWith('text/')) return 'text'
  if (m.includes('zip') || m.includes('compressed')) return 'archive'
  return 'file'
}

// Picks the cohort the new intake registers into.
// 1) running cohort (start <= now <= end, latest start wins)
// 2) next cohort opening soonest
// 3) most recent past cohort
export function selectIntakeCohort(cohorts, now = new Date()) {
  if (!Array.isArray(cohorts) || cohorts.length === 0) return null
  const withDates = cohorts
    .map(c => ({ ...c, _start: new Date(c.startDate), _end: new Date(c.endDate) }))
    .sort((a, b) => b._start - a._start)

  const running = withDates.filter(c => c._start <= now && now <= c._end)
  if (running.length) return running[0]

  const upcoming = withDates.filter(c => c._start > now).sort((a, b) => a._start - b._start)
  if (upcoming.length) return upcoming[0]

  return withDates[0]
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    studentName: user.studentName,
    email: user.email,
    role: user.role,
    imageUrl: user.imageUrl,
    expectation: user.expectation,
    points: user.points ?? 0,
    cohortId: user.cohortId,
    courseId: user.courseId,
    createdAt: user.createdAt,
  }
}
