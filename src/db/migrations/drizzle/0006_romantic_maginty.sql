ALTER TABLE "Geschäftsprozesse" RENAME TO "geschaeftsprozesse";--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submission_links" RENAME TO "geschaeftsprozesse_submission_links";--> statement-breakpoint
ALTER TABLE "geschäftsprozesse_submissions" RENAME TO "geschaeftsprozesse_submissions";--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" RENAME COLUMN "geschäftsprozesse_id" TO "geschaeftsprozesse_id";--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse" DROP CONSTRAINT "Geschäftsprozesse_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submission_links" DROP CONSTRAINT "geschäftsprozesse_submission_links_submission_id_geschäftsprozesse_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" DROP CONSTRAINT "geschäftsprozesse_submissions_trainee_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" DROP CONSTRAINT "geschäftsprozesse_submissions_geschäftsprozesse_id_Geschäftsprozesse_id_fk";
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" DROP CONSTRAINT "geschäftsprozesse_submissions_reviewed_by_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse" ADD CONSTRAINT "geschaeftsprozesse_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submission_links" ADD CONSTRAINT "geschaeftsprozesse_submission_links_submission_id_geschaeftsprozesse_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."geschaeftsprozesse_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" ADD CONSTRAINT "geschaeftsprozesse_submissions_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" ADD CONSTRAINT "geschaeftsprozesse_submissions_geschaeftsprozesse_id_geschaeftsprozesse_id_fk" FOREIGN KEY ("geschaeftsprozesse_id") REFERENCES "public"."geschaeftsprozesse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geschaeftsprozesse_submissions" ADD CONSTRAINT "geschaeftsprozesse_submissions_reviewed_by_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;