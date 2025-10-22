import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import {
  profiles,
  modules,
  lessons,
  subLessons,
  progress,
  quizzes,
  questions,
  options,
  quizSubmissions,
  submissionAnswers,
  knowledgeSubmissions,
  reflections,
  testimonials,
  acceptanceProtocols,
} from './migrations/schemas/schema';

async function main() {
  if (!process.env.DB_CONNECTION_STRING) {
    throw new Error('DB_CONNECTION_STRING is not defined');
  }

  const sql = postgres(process.env.DB_CONNECTION_STRING, { max: 1 });
  const db = drizzle(sql);

  // Seed everything inside a transaction for safety
  await db.transaction(async (tx) => {
    // 1) Clean existing data (delete in FK-safe order)
    await tx.delete(submissionAnswers);
    await tx.delete(quizSubmissions);
    await tx.delete(options);
    await tx.delete(questions);
    await tx.delete(quizzes);
    await tx.delete(progress);
    await tx.delete(subLessons);
    await tx.delete(lessons);
    await tx.delete(modules);
    await tx.delete(acceptanceProtocols);
    await tx.delete(testimonials);
    await tx.delete(reflections);
    await tx.delete(knowledgeSubmissions);
    await tx.delete(profiles);

    // 2) Insert base entities
  const trainerAuthId = randomUUID();
  const traineeAuthId = randomUUID();

    const [trainer] = await tx
      .insert(profiles)
      .values({
        auth_id: trainerAuthId,
        full_name: 'Alex Trainer',
        role: 'trainer',
        avatar_url: null,
        training_start_date: null,
      })
      .returning();

    const [trainee] = await tx
      .insert(profiles)
      .values({
        auth_id: traineeAuthId,
        full_name: 'Jamie Trainee',
        role: 'trainee',
        avatar_url: null,
        trainer_auth_id: trainerAuthId,
        training_start_date: new Date().toISOString().slice(0, 10),
      })
      .returning();

    const [module1] = await tx
      .insert(modules)
      .values({
        title: 'Introduction to Web Development',
        training_year: 1,
        order_index: 1,
        duration_days: 30,
        created_by: trainer.id,
      })
      .returning();

    const [lesson1] = await tx
      .insert(lessons)
      .values({
        module_id: module1.id,
        rahmenplan_reference_code: 'RP-101',
        title: 'HTML & CSS Basics',
        order_index: 1,
        duration_weeks: 1,
        created_by: trainer.id,
      })
      .returning();

    const [lesson2] = await tx
      .insert(lessons)
      .values({
        module_id: module1.id,
        rahmenplan_reference_code: 'RP-102',
        title: 'JavaScript Fundamentals',
        order_index: 2,
        duration_weeks: 2,
        created_by: trainer.id,
      })
      .returning();

    const [sub1] = await tx
      .insert(subLessons)
      .values({
        lesson_id: lesson1.id,
        title: 'Intro to HTML',
        content:
          'Learn basic HTML tags, structure, and semantics. Build your first page.',
        exercise_prompt: 'Create an HTML page with a header, nav, and footer.',
        exercise_solution: '<!doctype html><html>...</html>',
        order_index: 1,
        duration_minutes: 60,
        created_by: trainer.id,
      })
      .returning();

    const [sub2] = await tx
      .insert(subLessons)
      .values({
        lesson_id: lesson1.id,
        title: 'Styling with CSS',
        content: 'Selectors, box model, flexbox, and responsive design.',
        exercise_prompt: 'Style your HTML page using a responsive layout.',
        exercise_solution: '/* CSS solution snippet */',
        order_index: 2,
        duration_minutes: 60,
        created_by: trainer.id,
      })
      .returning();

    const [sub3] = await tx
      .insert(subLessons)
      .values({
        lesson_id: lesson2.id,
        title: 'JS Variables and Functions',
        content: 'Variables, scopes, functions, and basic DOM manipulation.',
        exercise_prompt: 'Write a function that toggles a menu.',
        exercise_solution: 'function toggleMenu() { /* ... */ }',
        order_index: 1,
        duration_minutes: 60,
        created_by: trainer.id,
      })
      .returning();

    // Progress: trainee completed first sub-lesson
    await tx.insert(progress).values({
      user_id: trainee.id,
      sub_lesson_id: sub1.id,
      completed_at: new Date(),
    });

    // Quiz for lesson2
    const [quiz1] = await tx
      .insert(quizzes)
      .values({
        quiz_type: 'mini',
        title: 'JS Basics Quiz',
        lesson_id: lesson2.id,
        module_id: module1.id,
        training_year: 1,
        time_limit_minutes: 15,
        created_by: trainer.id,
      })
      .returning();

    const [q1] = await tx
      .insert(questions)
      .values({
        quiz_id: quiz1.id,
        question_text: 'Which keyword declares a block-scoped variable?',
        question_type: 'multiple_choice',
        order_index: 1,
        created_by: trainer.id,
      })
      .returning();

    const [q2] = await tx
      .insert(questions)
      .values({
        quiz_id: quiz1.id,
        question_text: 'true/false: const variables can be reassigned.',
        question_type: 'true_false',
        order_index: 2,
        created_by: trainer.id,
      })
      .returning();

    const [q1o1, q1o2, q1o3] = await tx
      .insert(options)
      .values([
        { question_id: q1.id, option_text: 'var', is_correct: false },
        { question_id: q1.id, option_text: 'let', is_correct: true },
        { question_id: q1.id, option_text: 'function', is_correct: false },
      ])
      .returning();

    const [q2o1, q2o2] = await tx
      .insert(options)
      .values([
        { question_id: q2.id, option_text: 'true', is_correct: false },
        { question_id: q2.id, option_text: 'false', is_correct: true },
      ])
      .returning();

    // A submission from trainee
    const [subm1] = await tx
      .insert(quizSubmissions)
      .values({ user_id: trainee.id, quiz_id: quiz1.id, score: 100, created_by: trainee.id })
      .returning();

    await tx.insert(submissionAnswers).values([
      { submission_id: subm1.id, question_id: q1.id, selected_option_id: q1o2.id, created_by: trainee.id },
      { submission_id: subm1.id, question_id: q2.id, selected_option_id: q2o2.id, created_by: trainee.id },
    ]);

    // Knowledge submission, reflections, testimonials, acceptance protocol
    await tx.insert(knowledgeSubmissions).values({
      user_id: trainee.id,
      title: 'CSS Layout Exercise',
      description: 'Demonstrated responsive layout with flexbox and grid.',
      file_url: 'https://example.com/files/layout.pdf',
      status: 'approved',
      reviewer_notes: 'Solid work and clear structure.',
      created_by: trainer.id,
      modified_by: trainer.id,
    });

    await tx.insert(reflections).values({
      user_id: trainee.id,
      due_date: new Date().toISOString().slice(0, 10),
      swot_strengths: 'Strong motivation, quick learner',
      swot_weaknesses: 'Limited prior JS experience',
      swot_opportunities: 'Mentorship, project-based learning',
      swot_threats: 'Time constraints',
      mes_status: 'On track',
      created_by: trainee.id,
      modified_by: trainee.id,
    });

    await tx.insert(testimonials).values({
      user_id: trainee.id,
      milestone: 'Completed Module 1',
      feedback_text: 'Learned the fundamentals and built my first responsive page.',
      created_by: trainee.id,
    });

    await tx.insert(acceptanceProtocols).values({
      trainee_id: trainee.id,
      trainer_id: trainer.id,
      milestone_name: 'Module 1 Acceptance',
      comments: 'Requirements met. Good understanding of basics.',
      protocol_pdf_url: 'https://example.com/files/acceptance.pdf',
      created_by: trainer.id,
      modified_by: trainer.id,
    });
  });

  await sql.end({ timeout: 1 });
  // eslint-disable-next-line no-console
  console.log('✅ Seed complete.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
