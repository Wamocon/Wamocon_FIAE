CREATE TABLE "grade_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" uuid NOT NULL,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hai_embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(3072);--> statement-breakpoint
ALTER TABLE "use_cases" ALTER COLUMN "year" SET DATA TYPE integer[];--> statement-breakpoint
ALTER TABLE "use_cases" ALTER COLUMN "training_stage" SET DATA TYPE integer[];--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD COLUMN "trainee_grade" "performance_rating";--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD COLUMN "release_grade" "performance_rating";--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD COLUMN "release_grade_comment" text;--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD COLUMN "release_grade_at" timestamp;--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD COLUMN "release_grade_by" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "exam_part" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "lernfelder" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD COLUMN "release_rating" "performance_rating";--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD COLUMN "release_comment" text;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD COLUMN "released_by" uuid;--> statement-breakpoint
ALTER TABLE "weekly_softskill_ratings" ADD COLUMN "release_rating" "performance_rating";--> statement-breakpoint
ALTER TABLE "weekly_softskill_ratings" ADD COLUMN "release_comment" text;--> statement-breakpoint
ALTER TABLE "grade_edit_history" ADD CONSTRAINT "grade_edit_history_changed_by_profiles_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD CONSTRAINT "activity_report_use_case_entries_release_grade_by_profiles_id_fk" FOREIGN KEY ("release_grade_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_released_by_profiles_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;