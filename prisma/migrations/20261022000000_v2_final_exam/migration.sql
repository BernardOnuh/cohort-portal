-- Course final tests: timed MCQ + practical, then the earn / certificate / bootcamp flow

-- AlterTable AITest
ALTER TABLE "AITest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'KNOWLEDGE_CHECK';
ALTER TABLE "AITest" ADD COLUMN "secondsPerQuestion" INTEGER;
ALTER TABLE "AITest" ADD COLUMN "practicalPrompt" TEXT;

-- AlterTable Certificate
ALTER TABLE "Certificate" ADD COLUMN "postUrl" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "platform" TEXT;

-- CreateTable ExamSession
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "questionStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "mcqDoneAt" DATETIME,
    "practicalUrl" TEXT,
    "practicalNote" TEXT,
    "practicalAt" DATETIME,
    "wantsToEarn" BOOLEAN,
    "joinedGroupAt" DATETIME,
    "wantsCertificate" BOOLEAN,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamSession_testId_fkey" FOREIGN KEY ("testId") REFERENCES "AITest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamSession_testId_studentId_key" ON "ExamSession"("testId", "studentId");
