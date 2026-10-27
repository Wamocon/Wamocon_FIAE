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


CREATE DOMAIN "public"."short_code" AS "text"
	CONSTRAINT "short_code_check" CHECK ((("length"(VALUE) <= 10)));


ALTER DOMAIN "public"."short_code" OWNER TO "postgres";


CREATE TYPE "public"."score_pair" AS (
	"a" integer,
	"b" integer
);


ALTER TYPE "public"."score_pair" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN');
$$;


ALTER FUNCTION "public"."is_platform_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "public"."user_role" DEFAULT 'TRAINEE'::"public"."user_role" NOT NULL,
    "code" "public"."short_code",
    "pair" "public"."score_pair",
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lernfelder" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "code" "text"
);


ALTER TABLE "public"."lernfelder" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lernfeld_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lernfeld_id" "uuid" NOT NULL,
    "target" "text" NOT NULL
);


ALTER TABLE "public"."lernfeld_mappings" OWNER TO "postgres";


CREATE SEQUENCE "public"."ticket_no_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."ticket_no_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "no" integer DEFAULT "nextval"('"public"."ticket_no_seq"'::"regclass") NOT NULL,
    "title" "text" NOT NULL
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


ALTER SEQUENCE "public"."ticket_no_seq" OWNED BY "public"."tickets"."no";


CREATE SEQUENCE "public"."standalone_seq"
    START WITH 100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."standalone_seq" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lernfeld_overview" AS
 SELECT "l"."id",
    "l"."title",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lernfeld_mappings" "m"
          WHERE ("m"."lernfeld_id" = "l"."id")) AS "mappings"
   FROM "public"."lernfelder" "l";


ALTER VIEW "public"."v_lernfeld_overview" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_profile_roles" AS
 SELECT "role",
    "count"(*) AS "total"
   FROM "public"."profiles"
  GROUP BY "role"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_profile_roles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lernfelder"
    ADD CONSTRAINT "lernfelder_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lernfeld_mappings"
    ADD CONSTRAINT "lernfeld_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("no");



CREATE INDEX "notifications_user_idx" ON "public"."notifications" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "profiles_touch" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."lernfeld_mappings"
    ADD CONSTRAINT "lernfeld_mappings_lernfeld_id_fkey" FOREIGN KEY ("lernfeld_id") REFERENCES "public"."lernfelder"("id") ON DELETE CASCADE;



CREATE POLICY "profiles_self" ON "public"."profiles" USING ((("id" = "auth"."uid"()) OR "public"."is_platform_owner"()));



CREATE POLICY "notifications_own" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."is_platform_owner"() TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."lernfelder" TO "service_role";



GRANT ALL ON TABLE "public"."lernfeld_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_no_seq" TO "service_role";



GRANT ALL ON TABLE "public"."v_lernfeld_overview" TO "service_role";



GRANT ALL ON TABLE "public"."mv_profile_roles" TO "service_role";



RESET ALL;
