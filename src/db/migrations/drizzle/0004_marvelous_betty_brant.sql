ALTER TABLE "quizzes" ALTER COLUMN "quiz_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."quiz_type";--> statement-breakpoint
CREATE TYPE "public"."quiz_type" AS ENUM('LESSON', 'GLOBAL');--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "quiz_type" SET DATA TYPE "public"."quiz_type" USING "quiz_type"::"public"."quiz_type";