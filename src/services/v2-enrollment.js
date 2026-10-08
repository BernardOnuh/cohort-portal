import { prisma } from '../db.js'

/** Main course + any extra courses the student joined during onboarding. */
export async function enrolledCourseIds(user) {
  const extra = await prisma.enrollment.findMany({ where: { studentId: user.id }, select: { courseId: true } })
  return [...new Set([user.courseId, ...extra.map(e => e.courseId)].filter(Boolean))]
}

export async function isEnrolled(user, courseId) {
  if (user.courseId === courseId) return true
  const row = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId: user.id, courseId } },
    select: { id: true },
  })
  return !!row
}
