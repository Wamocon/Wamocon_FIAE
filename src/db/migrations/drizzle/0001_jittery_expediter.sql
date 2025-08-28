CREATE TYPE "public"."question_type" AS ENUM('multiple_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "public"."quiz_type" AS ENUM('mini', 'big');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('trainee', 'trainer');--> statement-breakpoint
ALTER TABLE "acceptance_protocols" DROP CONSTRAINT "acceptance_protocols_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_submissions" DROP CONSTRAINT "knowledge_submissions_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "modules" DROP CONSTRAINT "modules_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "options" DROP CONSTRAINT "options_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT "questions_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "quizzes" DROP CONSTRAINT "quizzes_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "reflections" DROP CONSTRAINT "reflections_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "sub_lessons" DROP CONSTRAINT "sub_lessons_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "progress" DROP CONSTRAINT "progress_user_id_sub_lesson_id_pk";--> statement-breakpoint
ALTER TABLE "submission_answers" DROP CONSTRAINT "submission_answers_submission_id_question_id_pk";--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "trainee_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "trainer_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."submission_status";--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "status" SET DATA TYPE "public"."submission_status" USING "status"::"public"."submission_status";--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "module_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "order_index" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "duration_weeks" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "duration_weeks" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "modules" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "training_year" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "order_index" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "duration_days" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "duration_days" SET DEFAULT 365;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "options" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "question_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "options" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "trainer_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "training_start_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "sub_lesson_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "sub_lesson_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "progress" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "quiz_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "question_type" SET DATA TYPE "public"."question_type" USING "question_type"::"public"."question_type";--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "order_index" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "quiz_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "score" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "submitted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "quiz_type" SET DATA TYPE "public"."quiz_type" USING "quiz_type"::"public"."quiz_type";--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "lesson_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "lesson_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "module_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "module_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "training_year" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "time_limit_minutes" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "time_limit_minutes" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "reflections" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "due_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "submitted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reflections" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "sub_lessons" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "lesson_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "order_index" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "duration_minutes" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "duration_minutes" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sub_lessons" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "submission_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "submission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "question_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "question_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "selected_option_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "selected_option_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_answers" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "submitted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_submissions" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "options" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "auth_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "reflections" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "sub_lessons" ADD COLUMN "modified_by" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_trainer_id_profiles_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;