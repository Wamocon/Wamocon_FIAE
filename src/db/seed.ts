import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  profiles,
  courses,
  courseMembers,
  courseSkills,
  skills,
  enablers,
  enablerQuizzes,
  enablerCompletions,
  useCases,
  useCaseSubmissions,
  useCaseSubmissionLinks,
  quizzes,
  questions,
  options,
  quizAssignments,
  quizSubmissions,
  quizSubmissionAnswers,
  reflections,
  knowledgeNotes,
  acceptanceProtocols,
  traineeAchievedSkills,
  activityLog,
} from './migrations/schemas/schema';

async function main() {
  const { DB_CONNECTION_STRING } = process.env;
  if (!DB_CONNECTION_STRING) throw new Error('DB_CONNECTION_STRING is not defined');

  const sql = postgres(DB_CONNECTION_STRING, { max: 1 });
  const db = drizzle(sql);

  // Provided auth IDs
  const trainerId = 'f178409e-4991-4f81-8052-f90951ce1f81';
  const trainee1Id = 'e09b9c61-a86a-4ac2-9eb8-55fc49662b3e';
  const trainee2Id = 'b5abfe96-31a8-4160-8d60-100541bde1a7';

  await db.transaction(async (tx) => {
    // Clean relevant tables for repeatable seeding (FK-safe order)
    await tx.delete(activityLog);
    await tx.delete(quizSubmissionAnswers);
    await tx.delete(quizSubmissions);
    await tx.delete(quizAssignments);
    await tx.delete(options);
    await tx.delete(questions);
    await tx.delete(enablerQuizzes);
    await tx.delete(quizzes);
    await tx.delete(useCaseSubmissionLinks);
    await tx.delete(useCaseSubmissions);
    await tx.delete(reflections);
    await tx.delete(knowledgeNotes);
    await tx.delete(acceptanceProtocols);
    await tx.delete(traineeAchievedSkills);
    await tx.delete(enablerCompletions);
    await tx.delete(courseMembers);
    await tx.delete(courseSkills);
    await tx.delete(enablers);
    await tx.delete(useCases);
    await tx.delete(skills);
    await tx.delete(courses);
    await tx.delete(profiles);

    // Insert profiles for trainer and trainees
    await tx.insert(profiles).values([
      {
        id: trainerId,
        fullName: 'Trainer One',
        email: 'trainer.one@example.com',
        avatarUrl: null,
        role: 'TRAINER',
        startOfTrainingDate: null,
        assignedTrainerId: null,
      },
      {
        id: trainee1Id,
        fullName: 'Trainee Alpha',
        email: 'trainee.alpha@example.com',
        avatarUrl: null,
        role: 'TRAINEE',
        startOfTrainingDate: new Date(),
        assignedTrainerId: trainerId,
      },
      {
        id: trainee2Id,
        fullName: 'Trainee Beta',
        email: 'trainee.beta@example.com',
        avatarUrl: null,
        role: 'TRAINEE',
        startOfTrainingDate: new Date(),
        assignedTrainerId: trainerId,
      },
    ]);

    // Create a simple course and link members
    const [course] = await tx
      .insert(courses)
      .values({
        title: 'Web Essentials',
        description: 'Foundations of web development with hands-on practice.',
        year: 1,
        chapter: 1,
        createdById: trainerId,
        isActive: true,
        isPublished: true,
      })
      .returning();

    await tx.insert(courseMembers).values([
      { courseId: course.id, userId: trainerId, role: 'TRAINER' },
      { courseId: course.id, userId: trainee1Id, role: 'TRAINEE' },
      { courseId: course.id, userId: trainee2Id, role: 'TRAINEE' },
    ]);

    // Skills and course skills
    const insertedSkills = await tx
      .insert(skills)
      .values([
        { name: 'HTML/CSS' },
        { name: 'JavaScript' },
        { name: 'Git' },
      ])
      .returning();
    await tx.insert(courseSkills).values(
      insertedSkills.map((s) => ({ courseId: course.id, skillId: s.id }))
    );

    // Add one Enabler and one Use Case
    const [enabler] = await tx.insert(enablers).values({
      courseId: course.id,
      title: 'HTML & CSS Enabler',
      orderIndex: 1,
      pptUrl: null,
      videoUrl: null,
      scenarioText: 'Build a responsive landing page from a brief.',
      scenarioImageUrl: null,
      durationValue: 2,
      durationUnit: 'WEEKS',
      isActive: true,
    }).returning();

    await tx.insert(useCases).values({
      courseId: course.id,
      title: 'Responsive Layout Use Case',
      descriptionText: 'Create a responsive layout with header, grid, and footer.',
      orderIndex: 2,
      durationValue: 1,
      durationUnit: 'WEEKS',
      isActive: true,
    });

    // Enabler small quiz (ENABLER)
    const [enablerQuiz] = await tx
      .insert(quizzes)
      .values({
        title: 'Enabler Quiz: HTML & CSS',
        quizType: 'ENABLER',
        createdById: trainerId,
        isActive: true,
      })
      .returning();
    await tx.insert(enablerQuizzes).values({ enablerId: enabler.id, quizId: enablerQuiz.id });

    const enablerQs = await tx
      .insert(questions)
      .values([
        { quizId: enablerQuiz.id, questionText: 'Which tag creates a hyperlink?', orderIndex: 1 },
        { quizId: enablerQuiz.id, questionText: 'Which CSS property sets text color?', orderIndex: 2 },
      ])
      .returning();

    const [qA, qB] = enablerQs;
    const enablerOptsA = await tx
      .insert(options)
      .values([
        { questionId: qA.id, optionText: '<a>', isCorrect: true },
        { questionId: qA.id, optionText: '<link>', isCorrect: false },
        { questionId: qA.id, optionText: '<href>', isCorrect: false },
      ])
      .returning();
    const enablerOptsB = await tx
      .insert(options)
      .values([
        { questionId: qB.id, optionText: 'font-color', isCorrect: false },
        { questionId: qB.id, optionText: 'color', isCorrect: true },
        { questionId: qB.id, optionText: 'text-style', isCorrect: false },
      ])
      .returning();

    // Global quiz (GLOBAL) assigned to trainees
    const [globalQuiz] = await tx
      .insert(quizzes)
      .values({
        title: 'Global Quiz: Web Basics',
        quizType: 'GLOBAL',
        createdById: trainerId,
        isActive: true,
      })
      .returning();

    const globalQs = await tx
      .insert(questions)
      .values([
        { quizId: globalQuiz.id, questionText: 'CSS stands for?', orderIndex: 1 },
        { quizId: globalQuiz.id, questionText: 'JS is primarily executed in the ___?', orderIndex: 2 },
      ])
      .returning();
    const [g1, g2] = globalQs;
    const g1Opts = await tx
      .insert(options)
      .values([
        { questionId: g1.id, optionText: 'Cascading Style Sheets', isCorrect: true },
        { questionId: g1.id, optionText: 'Creative Styling Syntax', isCorrect: false },
        { questionId: g1.id, optionText: 'Computer Styled System', isCorrect: false },
      ])
      .returning();
    const g2Opts = await tx
      .insert(options)
      .values([
        { questionId: g2.id, optionText: 'Database', isCorrect: false },
        { questionId: g2.id, optionText: 'Browser', isCorrect: true },
        { questionId: g2.id, optionText: 'Server only', isCorrect: false },
      ])
      .returning();

    await tx.insert(quizAssignments).values([
      { quizId: globalQuiz.id, traineeId: trainee1Id, assignedById: trainerId },
      { quizId: globalQuiz.id, traineeId: trainee2Id, assignedById: trainerId },
    ]);

    // Submissions for global quiz
    const [sub1] = await tx
      .insert(quizSubmissions)
      .values({ traineeId: trainee1Id, quizId: globalQuiz.id, score: 100, isReviewed: false })
      .returning();
    const [sub2] = await tx
      .insert(quizSubmissions)
      .values({ traineeId: trainee2Id, quizId: globalQuiz.id, score: 50, isReviewed: false })
      .returning();

    // Pick correct options for answers
    const g1Correct = g1Opts.find((o) => o.isCorrect)!.id;
    const g2Correct = g2Opts.find((o) => o.isCorrect)!.id;
    const g1Wrong = g1Opts.find((o) => !o.isCorrect)!.id;
    const g2Wrong = g2Opts.find((o) => !o.isCorrect)!.id;

    await tx.insert(quizSubmissionAnswers).values([
      { submissionId: sub1.id, questionId: g1.id, selectedOptionId: g1Correct },
      { submissionId: sub1.id, questionId: g2.id, selectedOptionId: g2Correct },
      { submissionId: sub2.id, questionId: g1.id, selectedOptionId: g1Wrong },
      { submissionId: sub2.id, questionId: g2.id, selectedOptionId: g2Wrong },
    ]);

    // Reflections
    await tx.insert(reflections).values([
      { traineeId: trainee1Id, strengths: 'CSS layouts', weaknesses: 'JS basics', mesMore: 'Practice', mesEqual: 'Focus', isReviewed: false, reviewedById: null },
      { traineeId: trainee2Id, strengths: 'HTML semantics', weaknesses: 'Accessibility', mesMore: 'Refactor', mesEqual: 'Consistency', isReviewed: true, reviewedById: trainerId },
    ]);

    // Knowledge notes
    await tx.insert(knowledgeNotes).values([
      { traineeId: trainee1Id, title: 'Flexbox Cheatsheet', content: 'Notes on flex properties.', oneDriveLink: null },
      { traineeId: trainee2Id, title: 'CSS Grid Areas', content: 'Grid templates and areas.', oneDriveLink: 'https://1drv.ms/mock' },
    ]);

    // Use case submissions and links
    const [uc] = await tx
      .insert(useCases)
      .values({
        courseId: course.id,
        title: 'Forms and Validation',
        descriptionText: 'Build a form with validation using HTML/CSS/JS.',
        orderIndex: 3,
        durationValue: 1,
        durationUnit: 'WEEKS',
        isActive: true,
      })
      .returning();

    const [ucs1] = await tx
      .insert(useCaseSubmissions)
      .values({ traineeId: trainee1Id, useCaseId: uc.id, submissionText: 'My solution text', status: 'APPROVED', trainerFeedback: 'Good job', reviewedById: trainerId, reviewedAt: new Date() })
      .returning();
    const [ucs2] = await tx
      .insert(useCaseSubmissions)
      .values({ traineeId: trainee2Id, useCaseId: uc.id, submissionText: 'Links attached', status: 'PENDING' })
      .returning();
    await tx.insert(useCaseSubmissionLinks).values([
      { submissionId: ucs1.id, url: 'https://github.com/example/repo', description: 'GitHub Repo' },
      { submissionId: ucs2.id, url: 'https://1drv.ms/f/mock', description: 'OneDrive' },
    ]);

    // Acceptance protocols
    await tx.insert(acceptanceProtocols).values([
      { traineeId: trainee1Id, trainerId: trainerId, acceptanceDate: new Date(), milestone: 'Module 1 Complete', comments: 'Well done', instructions: 'Proceed to next module', pdfUrl: 'https://files.example.com/protocol1.pdf' },
      { traineeId: trainee2Id, trainerId: trainerId, acceptanceDate: new Date(), milestone: 'Onboarding', comments: 'Welcome aboard', instructions: 'Start Web Essentials', pdfUrl: 'https://files.example.com/protocol2.pdf' },
    ]);

    // Achieved skills
    await tx.insert(traineeAchievedSkills).values([
      { traineeId: trainee1Id, skillId: insertedSkills[0].id, achievedViaCourseId: course.id },
      { traineeId: trainee1Id, skillId: insertedSkills[1].id, achievedViaCourseId: course.id },
      { traineeId: trainee2Id, skillId: insertedSkills[0].id, achievedViaCourseId: course.id },
    ]);

    // Activity log
    await tx.insert(activityLog).values([
      { userId: trainee1Id, activityType: 'QUIZ_SUBMITTED', relatedItemId: sub1.id, relatedItemTable: 'quiz_submissions', context: { score: 100 } as any },
      { userId: trainee2Id, activityType: 'COURSE_ASSIGNED', relatedItemId: course.id, relatedItemTable: 'courses', context: { title: course.title } as any },
    ]);

    // Enabler completions
    await tx.insert(enablerCompletions).values([
      { traineeId: trainee1Id, enablerId: enabler.id },
    ]);
  });

  await sql.end({ timeout: 1 });
  console.log('✅ Seeded trainer, trainees, and full mock data across all tables.');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
