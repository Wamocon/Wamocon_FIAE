import {
  pgTable,
  uuid,
  text,
  pgEnum,
  timestamp,
  integer,
  boolean,
  real,
  primaryKey,
  unique,
  jsonb,
  pgSchema,
} from 'drizzle-orm/pg-core';

// --- SUPABASE AUTH HELPER ---
// Reference auth.users in the "auth" schema so we can define FKs without creating the table.
const auth = pgSchema('auth');
export const authUsers = auth.table('users', {
  id: uuid('id').primaryKey(),
});

// --- ENUMS ---
// Re-usable ENUM types for your database columns

export const userRole = pgEnum('user_role', ['TRAINER', 'TRAINEE']);
export const durationUnit = pgEnum('duration_unit', ['DAYS', 'WEEKS']);
export const quizType = pgEnum('quiz_type', ['LESSON', 'GLOBAL']);
export const questionType = pgEnum('question_type', ['MCQ', 'TEXT']);
export const quizDifficulty = pgEnum('quiz_difficulty', ['LOW', 'MEDIUM', 'HIGH']);
export const reviewStatus = pgEnum('review_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

// --- 1. CORE USER TABLES ---

export const profiles = pgTable('profiles', {
  // 1:1 link to the authenticated user in auth.users
  id: uuid('id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  // Allow null here because the Supabase auth trigger may create a profile
  // before our application sets the full name. We set it in the app after
  // signUp (see `src/app/register/page.tsx`).
  fullName: text('full_name'),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
  role: userRole('role').notNull(),
  isActive: boolean('is_active').default(false),
  startOfTrainingDate: timestamp('start_of_training_date'),

  // A trainee can be assigned to a specific trainer
  // Note: Do not add a self-referential FK here to avoid TS circular init errors.
  // You can enforce this in application logic or add the FK via a raw migration if needed.
  assignedTrainerId: uuid('assigned_trainer_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// --- 2. CONTENT MANAGEMENT TABLES ---

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  year: integer('year'), // 1, 2, or 3
  chapter: integer('chapter'), // For "capital 1 to n"

  // The main trainer who created the course
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => profiles.id),

  isActive: boolean('is_active').default(false),
  isPublished: boolean('is_published').default(false), // For drafts

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Many-to-many table linking courses to multiple trainers and trainees
export const courseMembers = pgTable(
  'course_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull(), // To store if the member is a co-trainer or trainee
  },
  (table) => ({
    // A user can only be in a course once
    unq: unique().on(table.courseId, table.userId),
  }),
);

// Table for skills, powering the "Skills Achieved" feature
export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

// Many-to-many table linking skills to courses
export const courseSkills = pgTable(
  'course_skills',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    // Set the composite primary key
    pk: primaryKey({ columns: [table.courseId, table.skillId] }),
  }),
);

// --- Course Content: Enablers & Use Cases ---

export const enablers = pgTable('enablers', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  orderIndex: integer('order_index').notNull(), // To set the order of modules

  // Content
  descriptionText: text('description_text'),
  pptUrl: text('ppt_url'), // Link to Supabase Storage
  videoUrl: text('video_url'), // Link to Supabase Storage or external
  scenarioText: text('scenario_text'),
  hintText: text('hint_text'),
  scenarioImageUrl: text('scenario_image_url'),
  // Multiple scenarios with hints (new)
  scenarios: jsonb('scenarios').$type<Array<{ text: string; hint?: string }>>(),

  // Settings
  durationValue: integer('duration_value'),
  durationUnit: durationUnit('duration_unit'),
  isActive: boolean('is_active').default(false),
  activatedAt: timestamp('activated_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const useCases = pgTable('use_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  descriptionText: text('description_text').notNull(),
  orderIndex: integer('order_index').notNull(),

  durationValue: integer('duration_value'),
  durationUnit: durationUnit('duration_unit'),
  isActive: boolean('is_active').default(false),
  activatedAt: timestamp('activated_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// --- Content Documents (PDFs for Flipbook Viewer) ---

export const contentDocumentType = pgEnum('content_document_type', ['THEORY', 'EXERCISE', 'REFERENCE', 'OTHER']);

export const contentDocuments = pgTable('content_documents', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Flexible linking - one of these will be set
  enablerId: uuid('enabler_id').references(() => enablers.id, { onDelete: 'cascade' }),
  useCaseId: uuid('use_case_id').references(() => useCases.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),

  // Document metadata
  title: text('title').notNull(),
  description: text('description'),
  documentType: contentDocumentType('document_type').default('THEORY'),

  // Storage info
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size'), // bytes
  mimeType: text('mime_type').default('application/pdf'),
  storageUrl: text('storage_url').notNull(), // Supabase Storage URL
  storagePath: text('storage_path'), // Path in bucket for deletion

  // Ordering for multiple docs
  orderIndex: integer('order_index').default(0),

  // Uploaded by
  uploadedById: uuid('uploaded_by_id').references(() => profiles.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// --- 3. QUIZ & SUBMISSION TABLES ---

export const quizzes = pgTable('quizzes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  // ENABLER = "small quiz", GLOBAL = "big quiz"
  quizType: quizType('quiz_type').notNull(),
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => profiles.id),
  isActive: boolean('is_active').default(false),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// 1:1 relationship linking a "small quiz" to its enabler
export const enablerQuizzes = pgTable('enabler_quizzes', {
  enablerId: uuid('enabler_id')
    .primaryKey()
    .references(() => enablers.id, { onDelete: 'cascade' }),
  quizId: uuid('quiz_id')
    .notNull()
    .unique()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
});

// New: allow up to three quizzes per enabler, one per difficulty
export const enablerQuizLinks = pgTable(
  'enabler_quiz_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enablerId: uuid('enabler_id')
      .notNull()
      .references(() => enablers.id, { onDelete: 'cascade' }),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    difficulty: quizDifficulty('difficulty').notNull(),
  },
  (table) => ({
    unqEnablerDifficulty: unique().on(table.enablerId, table.difficulty),
    unqQuiz: unique().on(table.quizId),
  }),
);

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  questionText: text('question_text').notNull(),
  // MCQ or free-text question
  questionType: questionType('question_type').notNull().default('MCQ'),
  // For TEXT questions, an optional expected answer for trainer reference
  expectedAnswer: text('expected_answer'),
  orderIndex: integer('order_index'),
});

export const options = pgTable('options', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id')
    .notNull()
    .references(() => questions.id, { onDelete: 'cascade' }),
  optionText: text('option_text').notNull(),
  isCorrect: boolean('is_correct').notNull().default(false),
  // Optional explanation (store on the correct option)
  explanation: text('explanation'),
});

// --- Trainee Submissions & Progress ---

// Assigns "GLOBAL" quizzes to trainees
export const quizAssignments = pgTable(
  'quiz_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    assignedById: uuid('assigned_by_id')
      .notNull()
      .references(() => profiles.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    unq: unique().on(table.quizId, table.traineeId), // Trainee can only be assigned once
  }),
);

// Header for a single quiz attempt
export const quizSubmissions = pgTable('quiz_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  score: real('score'), // A percentage, e.g., 85.5
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),

  // For "Action Required" dashboard
  isReviewed: boolean('is_reviewed').default(false),
  trainerFeedback: text('trainer_feedback'),
  reviewedById: uuid('reviewed_by_id').references(() => profiles.id),
  reviewedAt: timestamp('reviewed_at'),
  attemptNumber: integer('attempt_number'),
});

// Trainers explicitly added as collaborators on GLOBAL quizzes
export const quizMembers = pgTable(
  'quiz_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    addedById: uuid('added_by_id')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    unq: unique().on(table.quizId, table.trainerId),
  }),
);

// Trainee's answer for each question in that submission
export const quizSubmissionAnswers = pgTable('quiz_submission_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => quizSubmissions.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id')
    .notNull()
    .references(() => questions.id, { onDelete: 'cascade' }),
  // For MCQ answers; nullable to support TEXT questions
  selectedOptionId: uuid('selected_option_id')
    .references(() => options.id, { onDelete: 'cascade' }),
  // For TEXT answers
  textAnswer: text('text_answer'),
});

// Submissions for Use Cases
export const useCaseSubmissions = pgTable('use_case_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  useCaseId: uuid('use_case_id')
    .notNull()
    .references(() => useCases.id, { onDelete: 'cascade' }),
  submissionText: text('submission_text'),

  // For "Action Required" and progress
  status: reviewStatus('status').default('PENDING'),
  trainerFeedback: text('trainer_feedback'),
  reviewedById: uuid('reviewed_by_id').references(() => profiles.id),
  reviewedAt: timestamp('reviewed_at'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  attemptNumber: integer('attempt_number'),
});

// Stores multiple links for a single use case submission
export const useCaseSubmissionLinks = pgTable('use_case_submission_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => useCaseSubmissions.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  description: text('description'), // e.g., "GitHub Repo", "OneDrive"
});

// Geschäftsprozesse tables removed

// --- 4. TRAINEE-SPECIFIC TABLES ---

export const reflections = pgTable('reflections', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),

  // SWOT
  strengths: text('strengths'),
  weaknesses: text('weaknesses'),
  // MES
  mesMore: text('mes_more'),
  mesEqual: text('mes_equal'),

  // For the trainer's "Action Required" dashboard
  isReviewed: boolean('is_reviewed').default(false),
  reviewedById: uuid('reviewed_by_id').references(() => profiles.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// For the "Knowledge Transfer" feature
export const knowledgeNotes = pgTable('knowledge_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content'),
  oneDriveLink: text('onedrive_link'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// --- 5. PROTOCOL & ANALYTICS TABLES ---

export const acceptanceProtocols = pgTable('acceptance_protocols', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id),
  trainerId: uuid('trainer_id')
    .notNull()
    .references(() => profiles.id),

  acceptanceDate: timestamp('acceptance_date').notNull(),
  milestone: text('milestone').notNull(),
  comments: text('comments'),
  instructions: text('important_instructions'),

  // This timestamp "signs" the document
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  // Store the link to the generated PDF in Supabase Storage
  pdfUrl: text('pdf_url'),
});

// Tracks a trainee's achieved skills
export const traineeAchievedSkills = pgTable(
  'trainee_achieved_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),

    // Store how they earned it
    achievedViaCourseId: uuid('achieved_via_course_id').references(
      () => courses.id,
    ),
    achievedAt: timestamp('achieved_at').defaultNow().notNull(),
  },
  (table) => ({
    unq: unique().on(table.traineeId, table.skillId), // Can only achieve a skill once
  }),
);

// Central log for all major events (powers "Recent Activity" feeds)
export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id),
  activityType: text('activity_type').notNull(), // e.g., 'COURSE_COMPLETED'

  // Polymorphic link to the related item
  relatedItemId: uuid('related_item_id'),
  relatedItemTable: text('related_item_table'), // e.g., 'courses', 'quizzes'

  // Additional context as JSON
  context: jsonb('context'), // e.g., { courseName: 'Intro to Next.js' }

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Notifications sent between users (trainer/trainee)
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  // recipient of the notification
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  // who triggered the notification (optional)
  actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
  // categorization and content
  type: text('type').notNull(), // e.g., 'REFLECTION_SUBMITTED'
  title: text('title').notNull(),
  message: text('message'),
  linkUrl: text('link_url'),
  context: jsonb('context'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Tracks non-submittable progress, like watching a video
export const enablerCompletions = pgTable(
  'enabler_completions',
  {
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    enablerId: uuid('enabler_id')
      .notNull()
      .references(() => enablers.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at').defaultNow().notNull(),
  },
  (table) => ({
    // A trainee can only complete an enabler once
    pk: primaryKey({ columns: [table.traineeId, table.enablerId] }),
  }),
);

// Per-trainee activation overrides (nullable isActive => inherit default)
export const traineeEnablerOverrides = pgTable(
  'trainee_enabler_overrides',
  {
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    enablerId: uuid('enabler_id')
      .notNull()
      .references(() => enablers.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.traineeId, table.enablerId] }),
  }),
);

export const traineeUseCaseOverrides = pgTable(
  'trainee_use_case_overrides',
  {
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    useCaseId: uuid('use_case_id')
      .notNull()
      .references(() => useCases.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.traineeId, table.useCaseId] }),
  }),
);

// traineeGeschaeftsprozesseOverrides removed

// Trainee submissions for Enabler scenarios
export const enablerSubmissions = pgTable('enabler_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  enablerId: uuid('enabler_id')
    .notNull()
    .references(() => enablers.id, { onDelete: 'cascade' }),
  solutionText: text('solution_text'), // Legacy: single solution
  solutions: jsonb('solutions').$type<Array<{ scenarioIndex: number; text: string }>>(), // New: multiple scenario solutions
  status: reviewStatus('status').default('PENDING'),
  trainerFeedback: text('trainer_feedback'), // Legacy: single feedback
  feedbacks: jsonb('feedbacks').$type<Array<{ scenarioIndex: number; feedback: string }>>(), // New: multiple scenario feedbacks
  reviewedById: uuid('reviewed_by_id').references(() => profiles.id),
  reviewedAt: timestamp('reviewed_at'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  attemptNumber: integer('attempt_number'),
});

// ---------------------------------------------
// LEGACY CONTENT TABLE STUBS (for compatibility)
// These provide minimal shapes so existing routes compile.
// They can be removed once those routes are fully migrated
// to the new courses/enablers/use-cases schema.
// ---------------------------------------------

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  training_year: integer('training_year'),
  order_index: integer('order_index'),
  created_by: uuid('created_by'),
});

export const lessons = pgTable('lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  module_id: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  order_index: integer('order_index'),
  duration_weeks: integer('duration_weeks'),
  created_by: uuid('created_by'),
});

export const subLessons = pgTable('sub_lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  lesson_id: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
});

export const progress = pgTable('progress', {
  user_id: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }),
  sub_lesson_id: uuid('sub_lesson_id').references(() => subLessons.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// --- 8. HAI.AI TABLES ---
// AI Coach tables for embeddings, chat sessions, and messages

// Enum for embedding source types
export const haiSourceType = pgEnum('hai_source_type', ['enabler', 'course', 'document', 'quiz']);

// Enum for chat context types
export const haiContextType = pgEnum('hai_context_type', ['enabler', 'course', 'quiz', 'general']);

// Enum for message roles
export const haiMessageRole = pgEnum('hai_message_role', ['user', 'assistant', 'system']);

// HAI.ai Embeddings - stores vector embeddings for RAG
export const haiEmbeddings = pgTable('hai_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: text('source_type').notNull(), // 'enabler', 'course', 'document', 'quiz'
  sourceId: uuid('source_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  // Note: 'embedding' column is vector(768) - handled at DB level, not in Drizzle
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// HAI.ai Chat Sessions - stores conversation sessions
export const haiChatSessions = pgTable('hai_chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  contextType: text('context_type'), // 'enabler', 'course', 'quiz', 'general'
  contextId: uuid('context_id'),

  // Chat history features
  title: text('title'), // Auto-generated from first user message
  quizState: jsonb('quiz_state'), // For resuming quizzes: {quiz_id, current_question, answers, score}
  lastMessageAt: timestamp('last_message_at').defaultNow(), // For sorting by recency

  isActive: boolean('is_active').default(true), // false = archived (still visible, just not auto-loaded)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// HAI.ai Chat Messages - stores individual messages
export const haiChatMessages = pgTable('hai_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => haiChatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user', 'assistant', 'system'
  content: text('content').notNull(),
  citations: jsonb('citations').default([]),
  metadata: jsonb('metadata').default({}),
  tokensUsed: integer('tokens_used'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- TYPE EXPORTS ---
export type Profile = typeof profiles.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type CourseMember = typeof courseMembers.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type CourseSkill = typeof courseSkills.$inferSelect;
export type Enabler = typeof enablers.$inferSelect;
export type UseCase = typeof useCases.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type EnablerQuiz = typeof enablerQuizzes.$inferSelect;
export type EnablerQuizLink = typeof enablerQuizLinks.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Option = typeof options.$inferSelect;
export type QuizAssignment = typeof quizAssignments.$inferSelect;
export type QuizSubmission = typeof quizSubmissions.$inferSelect;
export type QuizMember = typeof quizMembers.$inferSelect;
export type QuizSubmissionAnswer = typeof quizSubmissionAnswers.$inferSelect;
export type UseCaseSubmission = typeof useCaseSubmissions.$inferSelect;
export type UseCaseSubmissionLink = typeof useCaseSubmissionLinks.$inferSelect;

// Removed geschäftsprozesse related types
export type Reflection = typeof reflections.$inferSelect;
export type KnowledgeNote = typeof knowledgeNotes.$inferSelect;
export type AcceptanceProtocol = typeof acceptanceProtocols.$inferSelect;
export type ActivityLog = typeof activityLog.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type EnablerCompletion = typeof enablerCompletions.$inferSelect;
export type EnablerSubmission = typeof enablerSubmissions.$inferSelect;
// Legacy compatibility types
export type LegacyModule = typeof modules.$inferSelect;
export type LegacyLesson = typeof lessons.$inferSelect;
export type LegacySubLesson = typeof subLessons.$inferSelect;

// HAI.ai types
export type HaiEmbedding = typeof haiEmbeddings.$inferSelect;
export type HaiChatSession = typeof haiChatSessions.$inferSelect;
export type HaiChatMessage = typeof haiChatMessages.$inferSelect;