ALTER TABLE "certificate_text_templates" ALTER COLUMN "competency_area" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mes_softskill_criteria" ALTER COLUMN "competency_area" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."competency_area";--> statement-breakpoint
CREATE TYPE "public"."competency_area" AS ENUM('FACHKOMPETENZ', 'METHODENKOMPETENZ', 'PERSONALKOMPETENZ');--> statement-breakpoint
ALTER TABLE "certificate_text_templates" ALTER COLUMN "competency_area" SET DATA TYPE "public"."competency_area" USING "competency_area"::"public"."competency_area";--> statement-breakpoint
ALTER TABLE "mes_softskill_criteria" ALTER COLUMN "competency_area" SET DATA TYPE "public"."competency_area" USING "competency_area"::"public"."competency_area";--> statement-breakpoint
ALTER TABLE "activity_reports" ADD COLUMN "skill_self_ratings" jsonb;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" DROP COLUMN "sozialkompetenz_avg";--> statement-breakpoint
ALTER TABLE "work_certificates" DROP COLUMN "sozialkompetenz_grade";