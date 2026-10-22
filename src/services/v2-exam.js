// V2 course final test rules — pure functions, unit-tested in tests/exam.test.js
import { randomBytes } from 'node:crypto'

export const FINAL_KIND = 'FINAL'
export const DEFAULT_SECONDS_PER_QUESTION = 30
/** slack for network latency before a question counts as timed out */
export const ANSWER_GRACE_MS = 3000

const LETTER_RE = /^[A-Z]$/

/**
 * Skip every question whose time ran out (tab closed, phone locked…). The clock keeps running,
 * so each skipped question hands its leftover start time to the next one.
 */
export function advanceExpired({ currentIndex, questionStartedAt }, total, secondsPerQuestion, now = new Date()) {
  const windowMs = secondsPerQuestion * 1000
  let index = currentIndex
  let start = new Date(questionStartedAt).getTime()
  while (index < total && now.getTime() > start + windowMs + ANSWER_GRACE_MS) {
    index++
    start += windowMs
  }
  return { currentIndex: index, questionStartedAt: new Date(start) }
}

export function secondsLeft(questionStartedAt, secondsPerQuestion, now = new Date()) {
  const ms = new Date(questionStartedAt).getTime() + secondsPerQuestion * 1000 - now.getTime()
  return Math.max(0, Math.ceil(ms / 1000))
}

/** A student's answer for one question: an option letter, or null when they let the timer run out. */
export function normalizeChoice(raw, optionCount) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const v = String(raw).trim().toUpperCase()
  if (!LETTER_RE.test(v) || v.charCodeAt(0) - 65 >= optionCount) return { ok: false }
  return { ok: true, value: v }
}

const PLATFORMS = [
  { platform: 'X', hosts: ['x.com', 'twitter.com', 'mobile.twitter.com'] },
  { platform: 'INSTAGRAM', hosts: ['instagram.com'] },
  { platform: 'TIKTOK', hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'] },
]

/** X, Instagram or TikTok post link → platform; anything else → null. */
export function socialPlatform(raw) {
  let url
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  // a bare profile/home page is not a post
  if (url.pathname.replace(/\/+$/, '') === '') return null
  return PLATFORMS.find(p => p.hosts.includes(host))?.platform ?? null
}

/** Practical work link (Figma, GitHub, Drive, CodePen…) — any http(s) URL. */
export function isWebUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

/** Short human-readable certificate id, e.g. W3N-7Q4K-M2XD */
export function certificateCode(bytes = randomBytes(8)) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]).join('')
  return `W3N-${chars.slice(0, 4)}-${chars.slice(4, 8)}`
}

/** Which screen of the post-test flow the student is on. */
export function examStage(s) {
  if (!s) return 'NOT_STARTED'
  if (!s.mcqDoneAt) return 'MCQ'
  if (!s.practicalAt) return 'PRACTICAL'
  if (s.wantsToEarn === null || s.wantsToEarn === undefined) return 'ASK_EARN'
  if (s.wantsToEarn && !s.joinedGroupAt) return 'JOIN_GROUP'
  if (!s.wantsToEarn && (s.wantsCertificate === null || s.wantsCertificate === undefined)) return 'ASK_CERTIFICATE'
  if ((s.wantsToEarn || s.wantsCertificate) && !s.certificateCode) return 'CERTIFICATE'
  return 'BOOTCAMP'
}
