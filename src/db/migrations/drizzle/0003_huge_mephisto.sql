ALTER TABLE "profiles" DROP CONSTRAINT "profiles_trainer_auth_id_profiles_auth_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "trainer_auth_id" SET DATA TYPE text;