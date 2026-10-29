-- Rollout rehearsal: invented sample rows in the shape of the production tables, so the
-- data steps of the series (learning field copy, enrollment backfill, Super admin
-- backfill, HAI index backfill) have rows to work on. Every name, address and text here is
-- made up. Runs only in the throwaway container, as the application role, in one
-- transaction. Fixed ids keep the rehearsal repeatable.

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'platform-admin@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'customer-admin@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'trainer-one@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'trainer-two@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'trainee-one@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'trainee-two@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'trainee-three@example.invalid');

insert into public.organizations
  (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_active, is_platform_owner)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Platform Org (invented)', 'platform-org', 'PRO', 50, 10, true, true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Customer Org (invented)', 'customer-org', 'LIGHT', 10, 2, true, false);

insert into public.profiles
  (id, email, full_name, role, organization_id, is_active, trainer_activated, start_of_training_date, ausbildung_duration_years)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'platform-admin@example.invalid', 'Platform Admin', 'ADMIN', 'bbbbbbbb-0000-4000-8000-000000000001', true, true, null, 3),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'customer-admin@example.invalid', 'Customer Admin', 'ADMIN', 'bbbbbbbb-0000-4000-8000-000000000002', true, true, null, 3),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'trainer-one@example.invalid', 'Trainer One', 'TRAINER', 'bbbbbbbb-0000-4000-8000-000000000001', true, true, null, 3),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'trainer-two@example.invalid', 'Trainer Two', 'TRAINER', 'bbbbbbbb-0000-4000-8000-000000000002', true, true, null, 3),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'trainee-one@example.invalid', 'Trainee One', 'TRAINEE', 'bbbbbbbb-0000-4000-8000-000000000001', true, true, '2025-08-01', 3),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'trainee-two@example.invalid', 'Trainee Two', 'TRAINEE', 'bbbbbbbb-0000-4000-8000-000000000002', true, true, '2026-08-01', 3),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'trainee-three@example.invalid', 'Trainee Three', 'TRAINEE', 'bbbbbbbb-0000-4000-8000-000000000002', true, false, '2026-08-01', 3);

insert into public.courses (id, title, year, chapter, created_by_id, is_active, is_published) values
  ('cccccccc-0000-4000-8000-000000000001', 'Course A (invented)', 1, 1, 'aaaaaaaa-0000-4000-8000-000000000003', true, true),
  ('cccccccc-0000-4000-8000-000000000002', 'Course B (invented)', 1, 2, 'aaaaaaaa-0000-4000-8000-000000000003', true, true),
  ('cccccccc-0000-4000-8000-000000000003', 'Course C (invented)', 2, 1, 'aaaaaaaa-0000-4000-8000-000000000003', false, false);

insert into public.course_members (course_id, user_id, role, organization_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'TRAINER', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005', 'TRAINEE', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000006', 'TRAINEE', 'bbbbbbbb-0000-4000-8000-000000000002');

insert into public.enablers (id, course_id, title, order_index, description_text, is_active) values
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Enabler 1 (invented)', 1, 'Invented text one.', true),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'Enabler 2 (invented)', 2, 'Invented text two.', true),
  ('dddddddd-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000002', 'Enabler 3 (invented)', 1, 'Invented text three.', true),
  ('dddddddd-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000003', 'Enabler 4 (invented)', 1, 'Invented text four.', false);

insert into public.use_cases (id, course_id, title, description_text, order_index, is_active) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Use case 1 (invented)', 'Invented task one.', 1, true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000002', 'Use case 2 (invented)', 'Invented task two.', 1, true);

insert into public.lernfelder (id, title, label, code, training_year, hours_budget, is_common, order_index) values
  ('ffffffff-0000-4000-8000-000000000001', 'Learning field 1 (invented)', 'LF1', null, null, null, true, null),
  ('ffffffff-0000-4000-8000-000000000002', 'Learning field 2 (invented)', 'LF2', null, null, null, true, null);

insert into public.lernfeld_mappings (lernfeld_id, enabler_id, use_case_id) values
  ('ffffffff-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', null),
  ('ffffffff-0000-4000-8000-000000000002', null, 'eeeeeeee-0000-4000-8000-000000000001');

insert into public.quizzes (id, title, quiz_type, created_by_id, is_active) values
  ('11111111-0000-4000-8000-000000000001', 'Lesson quiz (invented)', 'LESSON', 'aaaaaaaa-0000-4000-8000-000000000003', true),
  ('11111111-0000-4000-8000-000000000002', 'Global quiz (invented)', 'GLOBAL', 'aaaaaaaa-0000-4000-8000-000000000003', true);

insert into public.questions (id, quiz_id, question_text, order_index, question_type) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Invented question one?', 1, 'MCQ'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'Invented question two?', 1, 'MCQ');

insert into public.options (question_id, option_text, is_correct, explanation) values
  ('22222222-0000-4000-8000-000000000001', 'Yes', true, 'Invented reason.'),
  ('22222222-0000-4000-8000-000000000001', 'No', false, null),
  ('22222222-0000-4000-8000-000000000002', 'Yes', true, 'Invented reason.'),
  ('22222222-0000-4000-8000-000000000002', 'No', false, null);

insert into public.enabler_quiz_links (enabler_id, quiz_id, difficulty) values
  ('dddddddd-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'LOW');

insert into public.content_documents
  (id, enabler_id, title, document_type, file_name, storage_url, visibility, organization_id) values
  ('33333333-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'Text (invented)', 'THEORY', 'a.pdf', 'https://example.invalid/content/a.pdf', 'ALL', null),
  ('33333333-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 'Solution (invented)', 'TRAINER_SOLUTION', 'b.pdf', 'private://content-solutions/b.pdf', 'TRAINER_ONLY', 'bbbbbbbb-0000-4000-8000-000000000001');

insert into public.hai_embeddings (id, source_type, source_id, chunk_index, content, content_hash, embedding)
select gen_random_uuid(), t.source_type, t.source_id, 0, 'Invented chunk ' || t.n, 'hash-' || t.n,
       (select array_agg(0.01::real) from generate_series(1, 3072))::vector
from (values
  (1, 'enabler', 'dddddddd-0000-4000-8000-000000000001'::uuid),
  (2, 'enabler', 'dddddddd-0000-4000-8000-000000000002'::uuid),
  (3, 'course', 'cccccccc-0000-4000-8000-000000000001'::uuid),
  (4, 'document', '33333333-0000-4000-8000-000000000001'::uuid),
  (5, 'use_case', 'eeeeeeee-0000-4000-8000-000000000001'::uuid),
  (6, 'quiz', '11111111-0000-4000-8000-000000000001'::uuid)
) as t (n, source_type, source_id);
