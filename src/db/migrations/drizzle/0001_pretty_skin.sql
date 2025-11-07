CREATE TABLE "enabler_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainee_id" uuid NOT NULL,
	"enabler_id" uuid NOT NULL,
	"solution_text" text,
	"status" "review_status" DEFAULT 'PENDING',
	"trainer_feedback" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid,
	"title" text NOT NULL,
	"order_index" integer,
	"duration_weeks" integer,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"training_year" integer,
	"order_index" integer,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"user_id" uuid,
	"sub_lesson_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid,
	"title" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enablers" ADD COLUMN "description_text" text;--> statement-breakpoint
ALTER TABLE "enablers" ADD COLUMN "hint_text" text;--> statement-breakpoint
ALTER TABLE "enablers" ADD COLUMN "activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_active" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD CONSTRAINT "enabler_submissions_trainee_id_profiles_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD CONSTRAINT "enabler_submissions_enabler_id_enablers_id_fk" FOREIGN KEY ("enabler_id") REFERENCES "public"."enablers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enabler_submissions" ADD CONSTRAINT "enabler_submissions_reviewed_by_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_sub_lesson_id_sub_lessons_id_fk" FOREIGN KEY ("sub_lesson_id") REFERENCES "public"."sub_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_lessons" ADD CONSTRAINT "sub_lessons_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;