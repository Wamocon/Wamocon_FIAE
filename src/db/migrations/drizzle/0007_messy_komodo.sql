CREATE TYPE "public"."question_type" AS ENUM('MCQ', 'TEXT');--> statement-breakpoint
CREATE TABLE "quiz_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"added_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_members_quiz_id_trainer_id_unique" UNIQUE("quiz_id","trainer_id")
);
--> statement-breakpoint
CREATE TABLE "trainee_enabler_overrides" (
	"trainee_id" uuid NOT NULL,
	"enabler_id" uuid NOT NULL,
	"is_active" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trainee_enabler_overrides_trainee_id_enabler_id_pk" PRIMARY KEY("trainee_id","enabler_id")
);
--> statement-breakpoint
CREATE TABLE "trainee_use_case_overrides" (
	"trainee_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"is_active" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trainee_use_case_overrides_trainee_id_use_case_id_pk" PRIMARY KEY("trainee_id","use_case_id")
);
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submission_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "geschaeftsprozesse" CASCADE;--> statement-breakpoint
DROP TABLE "geschaeftsprozesse_submission_links" CASCADE;--> statement-breakpoint
DROP TABLE "geschaeftsprozesse_submissions" CASCADE;--> statement-breakpoint
ALTER TABLE "quiz_submission_answers" ALTER COLUMN "selected_option_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "question_type" "question_type" DEFAULT 'MCQ' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "expected_answer" text;--> statement-breakpoint
ALTER TABLE "quiz_submission_answers" ADD COLUMN "text_answer" text;--> statement-breakpoint
ALTER TABLE "quiz_members" ADD CONSTRAINT "quiz_members_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_members" ADD CONSTRAINT "quiz_members_trainer_id_profiles_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_members" ADD CONSTRAINT "quiz_members_added_by_id_profiles_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainee_enabler_overrides" ADD CONSTRAINT "trainee_enabler_overrides_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainee_enabler_overrides" ADD CONSTRAINT "trainee_enabler_overrides_enabler_id_enablers_id_fk" FOREIGN KEY ("enabler_id") REFERENCES "public"."enablers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainee_use_case_overrides" ADD CONSTRAINT "trainee_use_case_overrides_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainee_use_case_overrides" ADD CONSTRAINT "trainee_use_case_overrides_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE cascade ON UPDATE no action;