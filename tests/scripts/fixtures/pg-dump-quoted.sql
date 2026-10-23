--
-- SYNTHETIC structure dump in the exact style of "supabase db dump -s public"
-- (pg_dump quotes every name). Invented tables, no data, no production content.
-- Test data for scripts/db/preview-rewrite.mjs (rewriteDump).
--


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."user_role" AS ENUM (
    'ADMIN',
    'TRAINER',
    'TRAINEE'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "public"."profiles" p
    JOIN "public"."organizations" o ON p."organization_id" = o."id"
    WHERE p."id" = "auth"."uid"() AND o."is_platform_owner" = true
  );
$$;


ALTER FUNCTION "public"."is_platform_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_platform_owner" boolean DEFAULT false NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."user_role" NOT NULL,
    "organization_id" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Lern Felder" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "Titel" "text" NOT NULL,
    "profile_id" "uuid" NOT NULL
);


ALTER TABLE "public"."Lern Felder" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" bigint NOT NULL,
    "author_id" "uuid" NOT NULL,
    "body" "text",
    "embedding" "public"."vector"(3)
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


ALTER TABLE "public"."notes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE OR REPLACE VIEW "public"."org_overview" AS
 SELECT "o"."id",
    "o"."name",
    ( SELECT "count"(*) AS "count"
           FROM "public"."profiles" "p"
          WHERE ("p"."organization_id" = "o"."id")) AS "members"
   FROM "public"."organizations" "o";


ALTER VIEW "public"."org_overview" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Profiles, created by public.sync_profile() after sign-in';



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Lern Felder"
    ADD CONSTRAINT "Lern Felder_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



CREATE OR REPLACE TRIGGER "profiles_touch" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."Lern Felder"
    ADD CONSTRAINT "Lern Felder_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "profiles_select_own_org" ON "public"."profiles" FOR SELECT USING ((("organization_id" = "public"."get_user_org_id"()) OR "public"."is_platform_owner"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "notes_own" ON "public"."notes" USING (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "claims_admin" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."profiles";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."Lern Felder" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."notes_id_seq" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



RESET ALL;
