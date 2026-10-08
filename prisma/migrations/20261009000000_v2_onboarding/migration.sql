-- V2 first-login onboarding: welcome story, profile bonus, 24h first-test lock, extra courses

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "onboardedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "profileCompletedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "profileBonus" INTEGER;

-- CreateTable Enrollment
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_courseId_key" ON "Enrollment"("studentId", "courseId");
