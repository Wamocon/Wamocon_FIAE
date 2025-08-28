ALTER TABLE "profiles" RENAME COLUMN "trainer_id" TO "trainer_auth_id";--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_trainer_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_trainer_auth_id_profiles_auth_id_fk" FOREIGN KEY ("trainer_auth_id") REFERENCES "public"."profiles"("auth_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_auth_id_unique" UNIQUE("auth_id");