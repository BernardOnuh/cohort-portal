-- Welcome anthem (gender) + bonus-task proofs reviewed by admins

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "gender" TEXT;

-- CreateTable TaskProof
CREATE TABLE "TaskProof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "task" TEXT NOT NULL DEFAULT 'INVITE_FRIENDS',
    "imageUrl" TEXT NOT NULL,
    "imagePublicId" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "points" INTEGER NOT NULL DEFAULT 0,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskProof_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskProof_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskProof_status_idx" ON "TaskProof"("status");
CREATE INDEX "TaskProof_studentId_task_idx" ON "TaskProof"("studentId", "task");
