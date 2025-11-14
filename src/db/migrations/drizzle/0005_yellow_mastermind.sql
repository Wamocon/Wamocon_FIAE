CREATE TYPE "public"."quiz_difficulty" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TABLE "Geschäftsprozesse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description_text" text NOT NULL,
	"order_index" integer NOT NULL,
	"duration_value" integer,
	"duration_unit" "duration_unit",
	"is_active" boolean DEFAULT false,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enabler_quiz_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabler_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"difficulty" "quiz_difficulty" NOT NULL,
	CONSTRAINT "enabler_quiz_links_enabler_id_difficulty_unique" UNIQUE("enabler_id","difficulty"),
	CONSTRAINT "enabler_quiz_links_quiz_id_unique" UNIQUE("quiz_id")
);
--> statement-breakpoint
CREATE TABLE "geschäftsprozesse_submission_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "geschäftsprozesse_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"geschäftsprozesse_id" uuid NOT NULL,
	"submission_text" text,
	"status" "review_status" DEFAULT 'PENDING',
	"trainer_feedback" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"attempt_number" integer
);
--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD COLUMN "attempt_number" integer;--> statement-breakpoint
ALTER TABLE "options" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "trainer_feedback" text;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "attempt_number" integer;--> statement-breakpoint
ALTER TABLE "use_case_submissions" ADD COLUMN "attempt_number" integer;--> statement-breakpoint
ALTER TABLE "Geschäftsprozesse" ADD CONSTRAINT "Geschäftsprozesse_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enabler_quiz_links" ADD CONSTRAINT "enabler_quiz_links_enabler_id_enablers_id_fk" FOREIGN KEY ("enabler_id") REFERENCES "public"."enablers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enabler_quiz_links" ADD CONSTRAINT "enabler_quiz_links_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submission_links" ADD CONSTRAINT "geschäftsprozesse_submission_links_submission_id_geschäftsprozesse_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."geschäftsprozesse_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submissions" ADD CONSTRAINT "geschäftsprozesse_submissions_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submissions" ADD CONSTRAINT "geschäftsprozesse_submissions_geschäftsprozesse_id_Geschäftsprozesse_id_fk" FOREIGN KEY ("geschäftsprozesse_id") REFERENCES "public"."Geschäftsprozesse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submissions" ADD CONSTRAINT "geschäftsprozesse_submissions_reviewed_by_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_reviewed_by_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;