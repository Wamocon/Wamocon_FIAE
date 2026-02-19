CREATE TYPE "public"."certificate_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ISSUED');--> statement-breakpoint
CREATE TYPE "public"."competency_area" AS ENUM('FACHKOMPETENZ', 'METHODENKOMPETENZ', 'SOZIALKOMPETENZ', 'PERSONALKOMPETENZ');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('ALL', 'TRAINEE_ONLY', 'TRAINER_ONLY');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."performance_rating" AS ENUM('1', '2', '3', '4', '5', '6');--> statement-breakpoint
ALTER TYPE "public"."content_document_type" ADD VALUE 'TRAINEE_QUESTION';--> statement-breakpoint
ALTER TYPE "public"."content_document_type" ADD VALUE 'TRAINER_SOLUTION';--> statement-breakpoint
ALTER TYPE "public"."hai_context_type" ADD VALUE 'use_case';--> statement-breakpoint
ALTER TYPE "public"."hai_source_type" ADD VALUE 'use_case';--> statement-breakpoint
CREATE TABLE "activity_report_use_case_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"planned_hours" real NOT NULL,
	"actual_hours" real NOT NULL,
	"is_overbooked" boolean DEFAULT false,
	"notes" text,
	"trainer_grade" "performance_rating",
	"grade_comment" text,
	"is_grade_approved" boolean DEFAULT false,
	"grade_approved_at" timestamp,
	"grade_approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "annual_performance_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"year" integer NOT NULL,
	"fachkompetenz_avg" real,
	"methodenkompetenz_avg" real,
	"sozialkompetenz_avg" real,
	"personalkompetenz_avg" real,
	"overall_average" real,
	"total_weeks_evaluated" integer DEFAULT 0,
	"evaluation_completion_rate" real,
	"below_cutoff_warning" boolean DEFAULT false,
	"discussion_date" timestamp,
	"discussion_summary" text,
	"discussion_conducted_by" uuid,
	"trainee_statement" text,
	"is_finalized" boolean DEFAULT false,
	"finalized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "annual_performance_summaries_trainee_id_ausbildungsjahr_year_unique" UNIQUE("trainee_id","ausbildungsjahr","year")
);
--> statement-breakpoint
CREATE TABLE "certificate_text_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competency_area" "competency_area" NOT NULL,
	"grade" "performance_rating" NOT NULL,
	"template_text" text NOT NULL,
	"is_system_default" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "certificate_text_templates_competency_area_grade_unique" UNIQUE("competency_area","grade")
);
--> statement-breakpoint
CREATE TABLE "hai_reindex_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"force_reindex" boolean DEFAULT false NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mes_softskill_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"k_level" text,
	"competency_area" "competency_area" NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mes_softskill_criteria_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "training_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"total_weeks" real NOT NULL,
	"total_hours" real NOT NULL,
	"training_year" integer,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_components_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "training_use_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"letter" text NOT NULL,
	"description" text NOT NULL,
	"planned_hours" real NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"activity_report_id" uuid,
	"week_number" integer NOT NULL,
	"year" integer NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"arp_use_case_id" uuid,
	"arp_theme_text" text,
	"self_rating" "performance_rating",
	"self_comment" text,
	"self_submitted_at" timestamp,
	"trainer_rating" "performance_rating" NOT NULL,
	"trainer_comment" text,
	"trainer_approved_at" timestamp,
	"status" "evaluation_status" DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "weekly_evaluations_trainee_id_week_number_year_unique" UNIQUE("trainee_id","week_number","year")
);
--> statement-breakpoint
CREATE TABLE "weekly_softskill_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekly_evaluation_id" uuid NOT NULL,
	"softskill_criterion_id" uuid NOT NULL,
	"self_rating" "performance_rating",
	"trainer_rating" "performance_rating" NOT NULL,
	"trainer_comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "weekly_softskill_ratings_weekly_evaluation_id_softskill_criterion_id_unique" UNIQUE("weekly_evaluation_id","softskill_criterion_id")
);
--> statement-breakpoint
CREATE TABLE "work_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"annual_summary_id" uuid,
	"certificate_type" text DEFAULT 'INTERIM' NOT NULL,
	"issue_date" timestamp NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"generated_text" text NOT NULL,
	"custom_summary" text,
	"fachkompetenz_grade" "performance_rating",
	"methodenkompetenz_grade" "performance_rating",
	"sozialkompetenz_grade" "performance_rating",
	"personalkompetenz_grade" "performance_rating",
	"snapshot_data" jsonb,
	"qr_verification_code" text,
	"qr_verification_url" text,
	"gender" text DEFAULT 'neutral',
	"pdf_url" text,
	"pdf_generated_at" timestamp,
	"status" "certificate_status" DEFAULT 'DRAFT',
	"approved_by_trainer_id" uuid,
	"approved_at" timestamp,
	"trainee_signed_at" timestamp,
	"trainer_signed_at" timestamp,
	"is_locked" boolean DEFAULT false,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "work_certificates_qr_verification_code_unique" UNIQUE("qr_verification_code")
);
--> statement-breakpoint
ALTER TABLE "reflections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "reflections" CASCADE;--> statement-breakpoint
ALTER TABLE "lernfelder" DROP CONSTRAINT "lernfelder_code_unique";--> statement-breakpoint
ALTER TABLE "content_documents" ADD COLUMN "visibility" "document_visibility" DEFAULT 'ALL';--> statement-breakpoint
ALTER TABLE "content_documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "content_documents" ADD COLUMN "is_indexed_by_hai" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "enablers" ADD COLUMN "scenario_pdf_url" text;--> statement-breakpoint
ALTER TABLE "hai_chat_sessions" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "hai_embeddings" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "lernfelder" ADD COLUMN "label" text NOT NULL;--> statement-breakpoint
ALTER TABLE "lernfelder" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "birth_date" timestamp;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "training_stage" integer;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "lernfelder" text[];--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD CONSTRAINT "activity_report_use_case_entries_report_id_activity_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."activity_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD CONSTRAINT "activity_report_use_case_entries_use_case_id_training_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."training_use_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_report_use_case_entries" ADD CONSTRAINT "activity_report_use_case_entries_grade_approved_by_profiles_id_fk" FOREIGN KEY ("grade_approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" ADD CONSTRAINT "annual_performance_summaries_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" ADD CONSTRAINT "annual_performance_summaries_discussion_conducted_by_profiles_id_fk" FOREIGN KEY ("discussion_conducted_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_text_templates" ADD CONSTRAINT "certificate_text_templates_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_use_cases" ADD CONSTRAINT "training_use_cases_component_id_training_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."training_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_trainer_id_profiles_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_activity_report_id_activity_reports_id_fk" FOREIGN KEY ("activity_report_id") REFERENCES "public"."activity_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_arp_use_case_id_training_use_cases_id_fk" FOREIGN KEY ("arp_use_case_id") REFERENCES "public"."training_use_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_softskill_ratings" ADD CONSTRAINT "weekly_softskill_ratings_weekly_evaluation_id_weekly_evaluations_id_fk" FOREIGN KEY ("weekly_evaluation_id") REFERENCES "public"."weekly_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_softskill_ratings" ADD CONSTRAINT "weekly_softskill_ratings_softskill_criterion_id_mes_softskill_criteria_id_fk" FOREIGN KEY ("softskill_criterion_id") REFERENCES "public"."mes_softskill_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_annual_summary_id_annual_performance_summaries_id_fk" FOREIGN KEY ("annual_summary_id") REFERENCES "public"."annual_performance_summaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_approved_by_trainer_id_profiles_id_fk" FOREIGN KEY ("approved_by_trainer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enablers" DROP COLUMN "scenario_text";--> statement-breakpoint
ALTER TABLE "enablers" DROP COLUMN "hint_text";--> statement-breakpoint
ALTER TABLE "enablers" DROP COLUMN "scenario_image_url";--> statement-breakpoint
ALTER TABLE "enablers" DROP COLUMN "scenarios";--> statement-breakpoint
ALTER TABLE "lernfelder" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "lernfelder" DROP COLUMN "training_year";--> statement-breakpoint
ALTER TABLE "lernfelder" DROP COLUMN "hours_budget";--> statement-breakpoint
ALTER TABLE "lernfelder" DROP COLUMN "is_common";--> statement-breakpoint
ALTER TABLE "lernfelder" DROP COLUMN "order_index";