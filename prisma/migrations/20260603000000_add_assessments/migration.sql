-- CreateTable: Assessment
CREATE TABLE "Assessment" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courseId" INTEGER NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AssessmentQuestion
CREATE TABLE "AssessmentQuestion" (
    "id" SERIAL NOT NULL,
    "prompt" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "assessmentId" INTEGER NOT NULL,

    CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AssessmentChoice
CREATE TABLE "AssessmentChoice" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "questionId" INTEGER NOT NULL,

    CONSTRAINT "AssessmentChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assessment_courseId_idx" ON "Assessment"("courseId");
CREATE INDEX "AssessmentQuestion_assessmentId_idx" ON "AssessmentQuestion"("assessmentId");
CREATE INDEX "AssessmentChoice_questionId_idx" ON "AssessmentChoice"("questionId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_assessmentId_fkey"
    FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssessmentChoice" ADD CONSTRAINT "AssessmentChoice_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
