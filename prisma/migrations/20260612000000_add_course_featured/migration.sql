-- Add homepage "featured" flag to courses
ALTER TABLE "Course" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
