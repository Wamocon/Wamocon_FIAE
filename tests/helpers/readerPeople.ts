// People and organizations of the reader tests on a real local PostgreSQL (packages OR1): three
// customer organizations with different catalogs, trainees of the KfBM and of FIAE, a trainer. Used by
// transfer-originals-reader.test.ts and documents-db.test.ts. Nothing here talks to a real service.
import type { Sql } from './transferDb';

export const FIAE = '00000000-0000-4000-8000-000000000001';
export const KFBM = '00000000-0000-4000-8000-000000000002';
export const id = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ORG_A = id(1); // customer, FIAE and KfBM
export const ORG_B = id(2); // customer, FIAE only
export const ORG_C = id(3); // another customer, FIAE and KfBM
export const T_KFBM = id(11); // trainee of org A, enrolled in the KfBM
export const T_FIAE = id(12); // trainee of org A, enrolled in FIAE
export const T_NO_KFBM = id(13); // trainee of org B, enrolled in the KfBM
export const T_OTHER = id(14); // trainee of org C, enrolled in the KfBM
export const T_NO_MEMBER = id(15); // trainee of org A, enrolled, not member of the course
export const TRAINER_A = id(21);
export const WORD =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function seedPeople(sql: Sql) {
  for (const [oid, slug, catalogs] of [
    [ORG_A, 'or1-a', [FIAE, KFBM]],
    [ORG_B, 'or1-b', [FIAE]],
    [ORG_C, 'or1-c', [FIAE, KFBM]],
  ] as const) {
    await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
              values (${oid}, ${slug}, ${slug}, 'PRO', 10, 10, false) on conflict (id) do nothing`;
    await sql`delete from organization_catalogs where organization_id = ${oid}`;
    for (const catalog of catalogs) {
      await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled) values (${oid}, ${catalog}, true)`;
    }
  }
  const people: Array<[string, string, string, string, string]> = [
    [T_KFBM, 'TRAINEE', ORG_A, KFBM, 'a'],
    [T_FIAE, 'TRAINEE', ORG_A, FIAE, 'b'],
    [T_NO_KFBM, 'TRAINEE', ORG_B, KFBM, 'c'],
    [T_OTHER, 'TRAINEE', ORG_C, KFBM, 'd'],
    [T_NO_MEMBER, 'TRAINEE', ORG_A, KFBM, 'e'],
    [TRAINER_A, 'TRAINER', ORG_A, KFBM, 'f'],
  ];
  for (const [pid, role, oid, catalog, tag] of people) {
    await sql`insert into auth.users (id, email) values (${pid}, ${`or1-${tag}@t.test`}) on conflict (id) do nothing`;
    await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated)
              values (${pid}, ${`or1-${tag}@t.test`}, ${role}, ${oid}, true, true) on conflict (id) do nothing`;
    if (role === 'TRAINEE') {
      await sql`insert into trainee_enrollments (trainee_id, training_catalog_id, start_date) values (${pid}, ${catalog}, '2026-09-01')`;
    }
  }
}

export async function activate(
  sql: Sql,
  enablerId: string,
  courseId: string,
  members: string[]
) {
  await sql`update courses set is_active = true, is_published = true where id = ${courseId}`;
  await sql`update enablers set is_active = true where id = ${enablerId}`;
  for (const member of members) {
    const [p] =
      await sql`select organization_id from profiles where id = ${member}`;
    await sql`insert into course_members (course_id, user_id, role, organization_id) values (${courseId}, ${member}, 'TRAINEE', ${p.organization_id}) on conflict do nothing`;
  }
}
