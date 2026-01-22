CREATE TYPE "public"."activity_report_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('SCHOOL', 'COMPANY', 'HOLIDAY', 'EXAM', 'PERSONAL', 'SONSTIGES', 'TRAINER_BLOCKER');--> statement-breakpoint
CREATE TYPE "public"."content_document_type" AS ENUM('THEORY', 'EXERCISE', 'REFERENCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."exam_sub_type" AS ENUM('IHK_ABSCHLUSSPRUEFUNG_T1', 'IHK_ABSCHLUSSPRUEFUNG_T2', 'KLAUSUR_WMC', 'KLAUSUR_ALLGEMEIN', 'PRAKTISCHE_PRUEFUNG', 'MUENDLICHE_PRUEFUNG', 'PROJEKTARBEIT', 'ANDERE');--> statement-breakpoint
CREATE TYPE "public"."exam_type" AS ENUM('KLAUSUR', 'TEST', 'ABGABE', 'PRAESENTATION', 'MUENDLICH');--> statement-breakpoint
CREATE TYPE "public"."hai_context_type" AS ENUM('enabler', 'course', 'quiz', 'general');--> statement-breakpoint
CREATE TYPE "public"."hai_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."hai_source_type" AS ENUM('enabler', 'course', 'document', 'quiz');--> statement-breakpoint
CREATE TABLE "activity_report_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"betriebliche_taetigkeit" text,
	"rahmenplan_ref" text,
	"betriebliche_stunden" real,
	"unterweisungen_themen" text,
	"unterweisungen_stunden" real,
	"berufsschul_themen" text,
	"berufsschul_stunden" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "activity_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"week_number" integer NOT NULL,
	"year" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"abteilung" text,
	"status" "activity_report_status" DEFAULT 'DRAFT',
	"submitted_at" timestamp,
	"reviewer_id" uuid,
	"reviewed_at" timestamp,
	"reviewer_feedback" text,
	"trainee_signed_at" timestamp,
	"trainer_signed_at" timestamp,
	"pdf_url" text,
	"pdf_generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ausbildung_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"schuljahr" text NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"calendar_week" integer NOT NULL,
	"year" integer NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"block_type" "block_type" NOT NULL,
	"block_number" integer,
	"title" text,
	"notes" text,
	"exam_sub_type" "exam_sub_type",
	"description" text,
	"is_personal" boolean DEFAULT false,
	"imported_from" text,
	"created_by_trainer_id" uuid,
	"requires_trainer_approval" boolean DEFAULT false,
	"approved_by_trainer_id" uuid,
	"approved_at" timestamp,
	"invitee_emails" text,
	"invitation_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "content_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabler_id" uuid,
	"use_case_id" uuid,
	"course_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"document_type" "content_document_type" DEFAULT 'THEORY',
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text DEFAULT 'application/pdf',
	"storage_url" text NOT NULL,
	"storage_path" text,
	"order_index" integer DEFAULT 0,
	"uploaded_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hai_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"tokens_used" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hai_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context_type" text,
	"context_id" uuid,
	"title" text,
	"quiz_state" jsonb,
	"last_message_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hai_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lernfeld_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lernfeld_id" uuid NOT NULL,
	"enabler_id" uuid,
	"use_case_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lernfeld_mappings_lernfeld_id_enabler_id_unique" UNIQUE("lernfeld_id","enabler_id"),
	CONSTRAINT "lernfeld_mappings_lernfeld_id_use_case_id_unique" UNIQUE("lernfeld_id","use_case_id")
);
--> statement-breakpoint
CREATE TABLE "lernfelder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"training_year" integer,
	"hours_budget" integer,
	"is_common" boolean DEFAULT true,
	"order_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lernfelder_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "school_exam_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"trainee_id" uuid NOT NULL,
	"grade" text,
	"points" integer,
	"percentage" real,
	"passed" boolean,
	"notes" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "school_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"schuljahr" text NOT NULL,
	"ausbildungsjahr" integer NOT NULL,
	"exam_date" timestamp NOT NULL,
	"day_of_week" text,
	"period" text,
	"teacher" text,
	"subject" text NOT NULL,
	"exam_type" "exam_type",
	"lernfeld_code" text,
	"notes" text,
	"is_personal" boolean DEFAULT false,
	"imported_from" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "full_name" SET DATA TYPE varchar(256);--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "avatar_url" SET DATA TYPE varchar(256);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "first_name" varchar(256);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_name" varchar(256);--> statement-breakpoint
ALTER TABLE "activity_report_entries" ADD CONSTRAINT "activity_report_entries_report_id_activity_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."activity_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_reviewer_id_profiles_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ADD CONSTRAINT "ausbildung_blocks_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ADD CONSTRAINT "ausbildung_blocks_created_by_trainer_id_profiles_id_fk" FOREIGN KEY ("created_by_trainer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ADD CONSTRAINT "ausbildung_blocks_approved_by_trainer_id_profiles_id_fk" FOREIGN KEY ("approved_by_trainer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_enabler_id_enablers_id_fk" FOREIGN KEY ("enabler_id") REFERENCES "public"."enablers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_uploaded_by_id_profiles_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hai_chat_messages" ADD CONSTRAINT "hai_chat_messages_session_id_hai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."hai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hai_chat_sessions" ADD CONSTRAINT "hai_chat_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lernfeld_mappings" ADD CONSTRAINT "lernfeld_mappings_lernfeld_id_lernfelder_id_fk" FOREIGN KEY ("lernfeld_id") REFERENCES "public"."lernfelder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lernfeld_mappings" ADD CONSTRAINT "lernfeld_mappings_enabler_id_enablers_id_fk" FOREIGN KEY ("enabler_id") REFERENCES "public"."enablers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lernfeld_mappings" ADD CONSTRAINT "lernfeld_mappings_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_exam_results" ADD CONSTRAINT "school_exam_results_exam_id_school_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."school_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_exam_results" ADD CONSTRAINT "school_exam_results_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_exams" ADD CONSTRAINT "school_exams_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;