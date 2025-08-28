ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'trainee';--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE public.profiles
ADD COLUMN auth_id uuid NOT NULL UNIQUE;
