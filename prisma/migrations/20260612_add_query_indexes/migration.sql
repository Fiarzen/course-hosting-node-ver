-- Indexes for token lookups and hot foreign-key filters.
CREATE INDEX "User_passwordResetToken_idx" ON "User"("passwordResetToken");
CREATE INDEX "User_emailVerificationToken_idx" ON "User"("emailVerificationToken");
CREATE INDEX "Lesson_courseId_idx" ON "Lesson"("courseId");
CREATE INDEX "LessonProgress_lessonId_idx" ON "LessonProgress"("lessonId");
