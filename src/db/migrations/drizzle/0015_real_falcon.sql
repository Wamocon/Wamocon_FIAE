-- Step 1: Create new enum and update existing enum
CREATE TYPE "public"."subscription_plan" AS ENUM('LIGHT', 'PRO');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'ADMIN' BEFORE 'TRAINER';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'TEMP_ADMIN' BEFORE 'TRAINER';--> statement-breakpoint

-- Step 2: Create organizations table
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"subscription_plan" "subscription_plan" NOT NULL,
	"max_trainee_seats" integer NOT NULL,
	"max_trainer_seats" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_platform_owner" boolean DEFAULT false NOT NULL,
	"contact_email" text,
	"contact_person" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);--> statement-breakpoint

-- Step 3: Seed the Wamocon platform-owner organization
INSERT INTO "organizations" ("id", "name", "slug", "subscription_plan", "max_trainee_seats", "max_trainer_seats", "is_active", "is_platform_owner")
VALUES ('00000000-0000-0000-0000-000000000001', 'Wamocon', 'wamocon', 'PRO', 9999, 9999, true, true);--> statement-breakpoint

-- Step 4: Add organization_id as NULLABLE first (so existing rows don't break)
ALTER TABLE "profiles" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "trainer_activated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_documents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "course_members" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "hai_chat_sessions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_notes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "quiz_assignments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "school_exams" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "use_case_submissions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "work_certificates" ADD COLUMN "organization_id" uuid;--> statement-breakpoint

-- Step 5: Backfill all existing data to Wamocon org
UPDATE "profiles" SET "organization_id" = '00000000-0000-0000-0000-000000000001', "trainer_activated" = true WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "acceptance_protocols" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "activity_log" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "activity_reports" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "annual_performance_summaries" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "ausbildung_blocks" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "course_members" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "enabler_submissions" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "hai_chat_sessions" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "knowledge_notes" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "notifications" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "quiz_assignments" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "quiz_submissions" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "school_exams" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "use_case_submissions" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "weekly_evaluations" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "work_certificates" SET "organization_id" = '00000000-0000-0000-0000-000000000001' WHERE "organization_id" IS NULL;--> statement-breakpoint

-- Step 6: Now enforce NOT NULL on org-scoped tables (profiles and content_documents stay nullable)
ALTER TABLE "acceptance_protocols" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reports" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course_members" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hai_chat_sessions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_notes" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_assignments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "school_exams" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "use_case_submissions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "work_certificates" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- Step 7: Add foreign key constraints
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_protocols" ADD CONSTRAINT "acceptance_protocols_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_performance_summaries" ADD CONSTRAINT "annual_performance_summaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ausbildung_blocks" ADD CONSTRAINT "ausbildung_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_members" ADD CONSTRAINT "course_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD CONSTRAINT "enabler_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hai_chat_sessions" ADD CONSTRAINT "hai_chat_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_notes" ADD CONSTRAINT "knowledge_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_assignments" ADD CONSTRAINT "quiz_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_exams" ADD CONSTRAINT "school_exams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_case_submissions" ADD CONSTRAINT "use_case_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_evaluations" ADD CONSTRAINT "weekly_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
