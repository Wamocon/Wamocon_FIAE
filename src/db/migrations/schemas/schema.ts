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
  varchar,
  vector,
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
export const quizDifficulty = pgEnum('quiz_difficulty', [
  'LOW',
  'MEDIUM',
  'HIGH',
]);
export const reviewStatus = pgEnum('review_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

// Arbeitszeugnis enums (moved here for declaration order)
export const performanceRating = pgEnum('performance_rating', [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
]);
export const certificateStatus = pgEnum('certificate_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'ISSUED',
]);
export const competencyArea = pgEnum('competency_area', [
  'FACHKOMPETENZ', // Technical competency
  'METHODENKOMPETENZ', // Methodological competency
  'SOZIALKOMPETENZ', // Social competency
  'PERSONALKOMPETENZ', // Personal competency
]);
export const evaluationStatus = pgEnum('evaluation_status', [
  'DRAFT',
  'SUBMITTED',
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
  fullName: varchar('full_name', { length: 256 }),
  firstName: varchar('first_name', { length: 256 }),
  lastName: varchar('last_name', { length: 256 }),
  email: text('email').notNull().unique(),
  avatarUrl: varchar('avatar_url', { length: 256 }),
  birthDate: timestamp('birth_date'),
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
  table => ({
    // A user can only be in a course once
    unq: unique().on(table.courseId, table.userId),
  })
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
  table => ({
    // Set the composite primary key
    pk: primaryKey({ columns: [table.courseId, table.skillId] }),
  })
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
  year: integer('year'),
  trainingStage: integer('training_stage'),
  lernfelder: text('lernfelder').array(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// --- Content Documents (PDFs for Flipbook Viewer) ---

// Extended document types for Use Case role-based visibility
export const contentDocumentType = pgEnum('content_document_type', [
  'THEORY', // Shared learning material (both roles)
  'EXERCISE', // General exercises
  'REFERENCE', // Reference material
  'OTHER', // Miscellaneous
  'TRAINEE_QUESTION', // Use Case: Questions only (visible to trainee)
  'TRAINER_SOLUTION', // Use Case: Full PDF with solutions (trainer only, HAI learns from this)
]);

// Role visibility for documents
export const documentVisibility = pgEnum('document_visibility', [
  'ALL',
  'TRAINEE_ONLY',
  'TRAINER_ONLY',
]);

export const contentDocuments = pgTable('content_documents', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Flexible linking - one of these will be set
  enablerId: uuid('enabler_id').references(() => enablers.id, {
    onDelete: 'cascade',
  }),
  useCaseId: uuid('use_case_id').references(() => useCases.id, {
    onDelete: 'cascade',
  }),
  courseId: uuid('course_id').references(() => courses.id, {
    onDelete: 'cascade',
  }),

  // Document metadata
  title: text('title').notNull(),
  description: text('description'),
  documentType: contentDocumentType('document_type').default('THEORY'),

  // Role-based visibility (derived from documentType but explicit for queries)
  visibility: documentVisibility('visibility').default('ALL'),

  // Storage info
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size'), // bytes
  mimeType: text('mime_type').default('application/pdf'),
  storageUrl: text('storage_url').notNull(), // Supabase Storage URL
  storagePath: text('storage_path'), // Path in bucket for deletion

  // PageIndex support for HAI
  pageCount: integer('page_count'), // Total pages in PDF
  isIndexedByHai: boolean('is_indexed_by_hai').default(false), // True after HAI ingestion

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
  table => ({
    unqEnablerDifficulty: unique().on(table.enablerId, table.difficulty),
    unqQuiz: unique().on(table.quizId),
  })
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
  table => ({
    unq: unique().on(table.quizId, table.traineeId), // Trainee can only be assigned once
  })
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
  table => ({
    unq: unique().on(table.quizId, table.trainerId),
  })
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
  selectedOptionId: uuid('selected_option_id').references(() => options.id, {
    onDelete: 'cascade',
  }),
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

// --- 4. TRAINEE-SPECIFIC TABLES ---

// Reflections table removed

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
      () => courses.id
    ),
    achievedAt: timestamp('achieved_at').defaultNow().notNull(),
  },
  table => ({
    unq: unique().on(table.traineeId, table.skillId), // Can only achieve a skill once
  })
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
  actorId: uuid('actor_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  // categorization and content
  type: text('type').notNull(), // e.g., 'QUIZ_SUBMITTED'
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
  table => ({
    // A trainee can only complete an enabler once
    pk: primaryKey({ columns: [table.traineeId, table.enablerId] }),
  })
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
  table => ({
    pk: primaryKey({ columns: [table.traineeId, table.enablerId] }),
  })
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
  table => ({
    pk: primaryKey({ columns: [table.traineeId, table.useCaseId] }),
  })
);

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
  solutions:
    jsonb('solutions').$type<Array<{ scenarioIndex: number; text: string }>>(), // New: multiple scenario solutions
  status: reviewStatus('status').default('PENDING'),
  trainerFeedback: text('trainer_feedback'), // Legacy: single feedback
  feedbacks:
    jsonb('feedbacks').$type<
      Array<{ scenarioIndex: number; feedback: string }>
    >(), // New: multiple scenario feedbacks
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
  module_id: uuid('module_id').references(() => modules.id, {
    onDelete: 'cascade',
  }),
  title: text('title').notNull(),
  order_index: integer('order_index'),
  duration_weeks: integer('duration_weeks'),
  created_by: uuid('created_by'),
});

export const subLessons = pgTable('sub_lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  lesson_id: uuid('lesson_id').references(() => lessons.id, {
    onDelete: 'cascade',
  }),
  title: text('title').notNull(),
});

export const progress = pgTable('progress', {
  user_id: uuid('user_id').references(() => profiles.id, {
    onDelete: 'cascade',
  }),
  sub_lesson_id: uuid('sub_lesson_id').references(() => subLessons.id, {
    onDelete: 'cascade',
  }),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// --- 8. HAI.AI TABLES ---
// AI Coach tables for embeddings, chat sessions, and messages

// Enum for embedding source types (extended for Use Cases)
export const haiSourceType = pgEnum('hai_source_type', [
  'enabler',
  'course',
  'document',
  'quiz',
  'use_case',
]);

// Enum for chat context types
export const haiContextType = pgEnum('hai_context_type', [
  'enabler',
  'course',
  'quiz',
  'general',
  'use_case',
]);

// Enum for message roles
export const haiMessageRole = pgEnum('hai_message_role', [
  'user',
  'assistant',
  'system',
]);

// HAI.ai Embeddings - stores vector embeddings for RAG with PageIndex support
export const haiEmbeddings = pgTable('hai_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: text('source_type').notNull(), // 'enabler', 'course', 'document', 'quiz', 'use_case'
  sourceId: uuid('source_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  // Enhanced metadata for PageIndex: { page?: number, documentId?: string, useCaseTitle?: string }
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// HAI.ai Reindex Jobs - tracks background reindexing with progress
export const haiReindexJobs = pgTable('hai_reindex_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('pending'), // 'pending', 'running', 'completed', 'failed', 'cancelled'
  forceReindex: boolean('force_reindex').notNull().default(false),
  progress: jsonb('progress').notNull().default({}),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
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
  metadata: jsonb('metadata').default({}), // Phase 2: conversation summary cache, etc.
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

// --- 9. SCHOOL VIEW TABLES ---
// Tables for Schul-Ansicht feature: Block Calendar, Exams, Lernfelder, Activity Reports

// Enum for calendar block types
// Note: Labels in UI - SCHOOL="Berufsschule", COMPANY="WMC", HOLIDAY="Urlaub"
export const blockType = pgEnum('block_type', [
  'SCHOOL', // Berufsschule block
  'COMPANY', // WMC (Betriebsphase)
  'HOLIDAY', // Urlaub (Ferien)
  'EXAM', // Prüfungszeitraum
  'PERSONAL', // Personal appointment/reminder
  'SONSTIGES', // Custom/Other blocker with description
  'TRAINER_BLOCKER', // Trainer-created blocker for trainee
]);

// Enum for exam sub-types (detailed Prüfung categories)
export const examSubType = pgEnum('exam_sub_type', [
  'IHK_ABSCHLUSSPRUEFUNG_T1', // IHK Abschlussprüfung Teil 1
  'IHK_ABSCHLUSSPRUEFUNG_T2', // IHK Abschlussprüfung Teil 2
  'KLAUSUR_WMC', // Klausur WMC
  'KLAUSUR_ALLGEMEIN', // Klausur (Allgemein)
  'PRAKTISCHE_PRUEFUNG', // Praktische Prüfung
  'MUENDLICHE_PRUEFUNG', // Mündliche Prüfung
  'PROJEKTARBEIT', // Projektarbeit
  'ANDERE', // Other exam type
]);

// Enum for activity report workflow status
export const activityReportStatus = pgEnum('activity_report_status', [
  'DRAFT', // Trainee is editing
  'SUBMITTED', // Submitted for trainer review
  'APPROVED', // Trainer approved (signed)
  'REJECTED', // Trainer rejected (needs revision)
]);

// Enum for exam types
export const examType = pgEnum('exam_type', [
  'KLAUSUR', // Written exam
  'TEST', // Short test
  'ABGABE', // Project submission
  'PRAESENTATION', // Presentation
  'MUENDLICH', // Oral exam
]);

// === AUSBILDUNG BLOCKS (Calendar) ===
// Stores school blocks, company phases, holidays, and personal appointments
export const ausbildungBlocks = pgTable('ausbildung_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),

  // Time scoping - data is year-specific
  schuljahr: text('schuljahr').notNull(), // e.g., "2026/2027"
  ausbildungsjahr: integer('ausbildungsjahr').notNull(), // 1, 2, or 3

  // Calendar positioning
  calendarWeek: integer('calendar_week').notNull(), // KW 1-52
  year: integer('year').notNull(), // Calendar year (e.g., 2026)
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),

  // Block details
  blockType: blockType('block_type').notNull(),
  blockNumber: integer('block_number'), // e.g., Block 5 for school
  title: text('title'), // Optional title for personal appointments
  notes: text('notes'), // e.g., "Prüfung Teil 1", "Herbstferien"

  // NEW: Exam sub-type for detailed Prüfung classification
  examSubType: examSubType('exam_sub_type'), // Only for EXAM blocks

  // NEW: Custom description for SONSTIGES blocks
  description: text('description'), // Detailed description for custom blockers

  // Source tracking
  isPersonal: boolean('is_personal').default(false), // true = student-created
  importedFrom: text('imported_from'), // CSV filename if imported

  // NEW: Trainer blocker fields
  createdByTrainerId: uuid('created_by_trainer_id').references(
    () => profiles.id
  ), // If trainer created this block
  requiresTrainerApproval: boolean('requires_trainer_approval').default(false),
  approvedByTrainerId: uuid('approved_by_trainer_id').references(
    () => profiles.id
  ),
  approvedAt: timestamp('approved_at'),

  // NEW: Invitation tracking
  inviteeEmails: text('invitee_emails'), // Comma-separated emails
  invitationSentAt: timestamp('invitation_sent_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// === SCHOOL EXAMS ===
// Tracks exam dates with subject/Lernfeld mapping
export const schoolExams = pgTable('school_exams', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),

  // Time scoping
  schuljahr: text('schuljahr').notNull(),
  ausbildungsjahr: integer('ausbildungsjahr').notNull(),

  // Exam details
  examDate: timestamp('exam_date').notNull(),
  dayOfWeek: text('day_of_week'), // "Mo", "Di", "Mi", "Do", "Fr"
  period: text('period'), // "1./2.", "3./4.", "7./8."
  teacher: text('teacher'), // Teacher code: "Gg", "Ma", "Ti"
  subject: text('subject').notNull(), // "LF5", "Deutsch", "Englisch"
  examTypeValue: examType('exam_type'), // KLAUSUR, TEST, ABGABE, etc.
  lernfeldCode: text('lernfeld_code'), // "LF1" through "LF12a" if applicable

  // Additional info
  notes: text('notes'),
  isPersonal: boolean('is_personal').default(false), // Student-added exam
  importedFrom: text('imported_from'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// === SCHOOL EXAM RESULTS ===
// Records exam outcomes with German grading
export const schoolExamResults = pgTable('school_exam_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id')
    .notNull()
    .references(() => schoolExams.id, { onDelete: 'cascade' }),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),

  // German grading (Note 1-6 or Punktzahl 0-15)
  grade: text('grade'), // "1", "2+", "3-", etc.
  points: integer('points'), // 0-15 for Oberstufe/IHK
  percentage: real('percentage'), // Optional percentage score
  passed: boolean('passed'),

  // Feedback
  notes: text('notes'),

  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// === LERNFELDER (Master Data) ===
// Pre-seeded reference data for FIAE Lernfelder LF1-LF12a
export const lernfelder = pgTable('lernfelder', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // "LF1", "LF10a", etc.
  title: text('title').notNull(),
  description: text('description'),

  // Curriculum info
  trainingYear: integer('training_year'), // 1, 2, or 3
  hoursBudget: integer('hours_budget'), // Zeitrichtwert in Stunden
  isCommon: boolean('is_common').default(true), // true = all IT, false = FIAE-only (LF10a-12a)

  // Ordering
  orderIndex: integer('order_index'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === LERNFELD MAPPINGS (Future: Content Linking) ===
// Links Lernfelder to platform content (Enablers, UseCases)
export const lernfeldMappings = pgTable(
  'lernfeld_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lernfeldId: uuid('lernfeld_id')
      .notNull()
      .references(() => lernfelder.id, { onDelete: 'cascade' }),
    enablerId: uuid('enabler_id').references(() => enablers.id, {
      onDelete: 'set null',
    }),
    useCaseId: uuid('use_case_id').references(() => useCases.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => ({
    // Each enabler/useCase can only be mapped once per Lernfeld
    unqEnablerLf: unique().on(table.lernfeldId, table.enablerId),
    unqUseCaseLf: unique().on(table.lernfeldId, table.useCaseId),
  })
);

// === ACTIVITY REPORTS (IHK Ausbildungsnachweis) ===
// Weekly training documentation with approval workflow
export const activityReports = pgTable('activity_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),

  // Report period identification
  ausbildungsjahr: integer('ausbildungsjahr').notNull(), // 1, 2, or 3
  weekNumber: integer('week_number').notNull(), // ISO week 1-52
  year: integer('year').notNull(), // Calendar year
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),

  // Department info (from IHK template)
  abteilung: text('abteilung'), // e.g., "FAE"

  // Workflow status
  status: activityReportStatus('status').default('DRAFT'),
  submittedAt: timestamp('submitted_at'),

  // Trainer review
  reviewerId: uuid('reviewer_id').references(() => profiles.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewerFeedback: text('reviewer_feedback'),

  // Digital signatures (timestamp = signed)
  traineeSignedAt: timestamp('trainee_signed_at'),
  trainerSignedAt: timestamp('trainer_signed_at'),

  // Generated PDF storage
  pdfUrl: text('pdf_url'),
  pdfGeneratedAt: timestamp('pdf_generated_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// === ACTIVITY REPORT ENTRIES ===
// Individual sections within a weekly report (matches IHK template structure)
export const activityReportEntries = pgTable('activity_report_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => activityReports.id, { onDelete: 'cascade' }),

  // Section 1: Betriebliche Tätigkeiten (Company Activities)
  betrieblicheTaetigkeit: text('betriebliche_taetigkeit'),
  rahmenplanRef: text('rahmenplan_ref'), // "Abschnitt A, Thema 1"
  betrieblicheStunden: real('betriebliche_stunden'),

  // Section 2: Unterweisungen (Instructions/Training)
  unterweisungenThemen: text('unterweisungen_themen'),
  unterweisungenStunden: real('unterweisungen_stunden'),

  // Section 3: Berufsschulunterricht (Vocational School Topics)
  berufsschulThemen: text('berufsschul_themen'),
  berufsschulStunden: real('berufsschul_stunden'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// === TRAINING COMPONENTS (FIAE Curriculum) ===
// Master data for Ausbildungsrahmenplan components (§4 Absatz 2, 3, 7)
export const trainingComponents = pgTable('training_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "§4.2.1", "§4.3.1"
  title: text('title').notNull(),
  description: text('description'),
  totalWeeks: real('total_weeks').notNull(), // Zeitrichtwert in Wochen
  totalHours: real('total_hours').notNull(), // totalWeeks * 40
  trainingYear: integer('training_year'), // 1, 2, or 3 (null = all years)
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === TRAINING USE CASES ===
// Individual skills/tasks within each component
export const trainingUseCases = pgTable('training_use_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  componentId: uuid('component_id')
    .notNull()
    .references(() => trainingComponents.id, { onDelete: 'cascade' }),
  letter: text('letter').notNull(), // a), b), c), etc.
  description: text('description').notNull(),
  plannedHours: real('planned_hours').notNull(), // Sollzeit in Stunden
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === ACTIVITY REPORT USE CASE ENTRIES ===
// Links activity reports to specific use cases with Plan vs Act tracking
export const activityReportUseCaseEntries = pgTable(
  'activity_report_use_case_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => activityReports.id, { onDelete: 'cascade' }),
    useCaseId: uuid('use_case_id')
      .notNull()
      .references(() => trainingUseCases.id, { onDelete: 'cascade' }),

    // Time tracking
    plannedHours: real('planned_hours').notNull(), // Sollzeit (copied from use case)
    actualHours: real('actual_hours').notNull(), // IST-Stunden (trainee input)
    isOverbooked: boolean('is_overbooked').default(false), // actual > planned

    // Optional notes
    notes: text('notes'),

    // === GRADING (for Arbeitszeugnis) ===
    trainerGrade: performanceRating('trainer_grade'), // 1-6 scale from trainer
    gradeComment: text('grade_comment'), // Optional grading comment
    isGradeApproved: boolean('is_grade_approved').default(false),
    gradeApprovedAt: timestamp('grade_approved_at'),
    gradeApprovedBy: uuid('grade_approved_by').references(() => profiles.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  }
);

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
export type HaiReindexJob = typeof haiReindexJobs.$inferSelect;
export type HaiChatSession = typeof haiChatSessions.$inferSelect;
export type HaiChatMessage = typeof haiChatMessages.$inferSelect;

// School View types
export type AusbildungBlock = typeof ausbildungBlocks.$inferSelect;
export type SchoolExam = typeof schoolExams.$inferSelect;
export type SchoolExamResult = typeof schoolExamResults.$inferSelect;
export type Lernfeld = typeof lernfelder.$inferSelect;
export type LernfeldMapping = typeof lernfeldMappings.$inferSelect;
export type ActivityReport = typeof activityReports.$inferSelect;
export type ActivityReportEntry = typeof activityReportEntries.$inferSelect;

// Training/Tätigkeitsnachweis types
export type TrainingComponent = typeof trainingComponents.$inferSelect;
export type TrainingUseCase = typeof trainingUseCases.$inferSelect;
export type ActivityReportUseCaseEntry =
  typeof activityReportUseCaseEntries.$inferSelect;

// Arbeitszeugnis types
export type MesSoftskillCriterion = typeof mesSoftskillCriteria.$inferSelect;
export type WeeklyEvaluation = typeof weeklyEvaluations.$inferSelect;
export type WeeklySoftskillRating = typeof weeklySoftskillRatings.$inferSelect;
export type AnnualPerformanceSummary =
  typeof annualPerformanceSummaries.$inferSelect;
export type WorkCertificate = typeof workCertificates.$inferSelect;
export type CertificateTextTemplate =
  typeof certificateTextTemplates.$inferSelect;

export const lernfelderSchema = pgTable('lernfelder', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  label: text('label').notNull(), // LF-1 to LF-12
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
});

// --- 10. ARBEITSZEUGNIS MODULE TABLES ---
// Module for automated work certificate generation based on weekly performance evaluations
// NOTE: Enums (performanceRating, certificateStatus, competencyArea, evaluationStatus)
// are defined at top of file with other enums

// MES Softskill Criteria (19 criteria from MES system)
export const mesSoftskillCriteria = pgTable('mes_softskill_criteria', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "K3.1", "K4.2"
  name: text('name').notNull(), // e.g., "Teamfähigkeit", "Problemlösefähigkeit"
  description: text('description'),
  kLevel: text('k_level'), // K3, K4, or K5 (ISTQB cognitive levels)
  competencyArea: competencyArea('competency_area').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Weekly Performance Evaluations
export const weeklyEvaluations = pgTable(
  'weekly_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Linking
    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    activityReportId: uuid('activity_report_id').references(
      () => activityReports.id,
      { onDelete: 'cascade' }
    ), // Link to existing weekly reports

    // Time period
    weekNumber: integer('week_number').notNull(), // ISO week 1-52
    year: integer('year').notNull(), // Calendar year
    ausbildungsjahr: integer('ausbildungsjahr').notNull(), // Training year 1, 2, or 3

    // ARP Theme Selection (from existing trainingUseCases)
    arpUseCaseId: uuid('arp_use_case_id').references(() => trainingUseCases.id),
    arpThemeText: text('arp_theme_text'), // Manual theme entry if not from dropdown

    // Trainee Self-Assessment
    selfRating: performanceRating('self_rating'),
    selfComment: text('self_comment'), // Max 500 characters
    selfSubmittedAt: timestamp('self_submitted_at'),

    // Trainer Assessment
    trainerRating: performanceRating('trainer_rating').notNull(),
    trainerComment: text('trainer_comment'), // Max 500 characters
    trainerApprovedAt: timestamp('trainer_approved_at'),

    // Workflow status
    status: evaluationStatus('status').notNull().default('DRAFT'),
    rejectionReason: text('rejection_reason'),

    // Metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  table => ({
    uniqueTraineeWeekYear: unique().on(
      table.traineeId,
      table.weekNumber,
      table.year
    ),
  })
);

// Softskill Weekly Ratings (19 criteria per week)
export const weeklySoftskillRatings = pgTable(
  'weekly_softskill_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    weeklyEvaluationId: uuid('weekly_evaluation_id')
      .notNull()
      .references(() => weeklyEvaluations.id, { onDelete: 'cascade' }),
    softskillCriterionId: uuid('softskill_criterion_id')
      .notNull()
      .references(() => mesSoftskillCriteria.id, { onDelete: 'cascade' }),

    // Ratings
    selfRating: performanceRating('self_rating'), // Trainee self-assessment
    trainerRating: performanceRating('trainer_rating').notNull(), // Trainer assessment (mandatory)

    trainerComment: text('trainer_comment'), // Optional comment on this specific skill

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  table => ({
    uniqueEvaluationCriterion: unique().on(
      table.weeklyEvaluationId,
      table.softskillCriterionId
    ),
  })
);

// Annual Performance Summary
export const annualPerformanceSummaries = pgTable(
  'annual_performance_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    traineeId: uuid('trainee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    ausbildungsjahr: integer('ausbildungsjahr').notNull(), // 1, 2, or 3
    year: integer('year').notNull(), // Calendar year

    // Competency Area Averages (automatically calculated)
    fachkompetenzAvg: real('fachkompetenz_avg'), // Technical competency average
    methodenkompetenzAvg: real('methodenkompetenz_avg'), // Methodological competency average
    sozialkompetenzAvg: real('sozialkompetenz_avg'), // Social competency average
    personalkompetenzAvg: real('personalkompetenz_avg'), // Personal competency average

    overallAverage: real('overall_average'), // Overall grade average across all areas

    // Statistical data
    totalWeeksEvaluated: integer('total_weeks_evaluated').default(0),
    evaluationCompletionRate: real('evaluation_completion_rate'), // Percentage of weeks evaluated

    // Warning flags
    belowCutoffWarning: boolean('below_cutoff_warning').default(false), // True if avg < 2.45 (shortening requirement)

    // Annual Discussion
    discussionDate: timestamp('discussion_date'),
    discussionSummary: text('discussion_summary'), // Trainer's summary of annual discussion
    discussionConductedBy: uuid('discussion_conducted_by').references(
      () => profiles.id
    ),
    traineeStatement: text('trainee_statement'), // Trainee's statement/response

    // Status
    isFinalized: boolean('is_finalized').default(false),
    finalizedAt: timestamp('finalized_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  table => ({
    uniqueTraineeYear: unique().on(
      table.traineeId,
      table.ausbildungsjahr,
      table.year
    ),
  })
);

// Work Certificates (Arbeitszeugnisse)
export const workCertificates = pgTable('work_certificates', {
  id: uuid('id').primaryKey().defaultRandom(),

  traineeId: uuid('trainee_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  annualSummaryId: uuid('annual_summary_id').references(
    () => annualPerformanceSummaries.id,
    { onDelete: 'set null' }
  ),

  // Certificate metadata
  certificateType: text('certificate_type').notNull().default('INTERIM'), // INTERIM (Zwischenzeugnis), FINAL (Endzeugnis)
  issueDate: timestamp('issue_date').notNull(),

  // Period covered
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  ausbildungsjahr: integer('ausbildungsjahr').notNull(),

  // Generated content
  generatedText: text('generated_text').notNull(), // Auto-generated based on grades
  customSummary: text('custom_summary'), // Trainer's mandatory summary (max 2000 chars) - PFLICHTFELD

  // Competency ratings (from annual summary)
  fachkompetenzGrade: performanceRating('fachkompetenz_grade'),
  methodenkompetenzGrade: performanceRating('methodenkompetenz_grade'),
  sozialkompetenzGrade: performanceRating('sozialkompetenz_grade'),
  personalkompetenzGrade: performanceRating('personalkompetenz_grade'),

  // === SNAPSHOT (Frozen grades at issue time) ===
  snapshotData: jsonb('snapshot_data'), // Frozen grades/component data at certificate issue

  // === QR CODE VERIFICATION ===
  qrVerificationCode: text('qr_verification_code').unique(), // Unique code for certificate verification
  qrVerificationUrl: text('qr_verification_url'), // Full URL for QR code

  // === GENDER-NEUTRAL PRONOUNS ===
  gender: text('gender').default('neutral'), // 'male', 'female', 'neutral'

  // PDF storage
  pdfUrl: text('pdf_url'), // Supabase storage URL
  pdfGeneratedAt: timestamp('pdf_generated_at'),

  // Approval workflow
  status: certificateStatus('status').default('DRAFT'),
  approvedByTrainerId: uuid('approved_by_trainer_id').references(
    () => profiles.id
  ),
  approvedAt: timestamp('approved_at'),

  // Digital signatures
  traineeSignedAt: timestamp('trainee_signed_at'),
  trainerSignedAt: timestamp('trainer_signed_at'),

  // Locking mechanism (once issued, cannot be edited)
  isLocked: boolean('is_locked').default(false),
  lockedAt: timestamp('locked_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Certificate Text Templates (Standard phrases per grade)
export const certificateTextTemplates = pgTable(
  'certificate_text_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    competencyArea: competencyArea('competency_area').notNull(),
    grade: performanceRating('grade').notNull(),

    // Template texts (German legal phrasing)
    templateText: text('template_text').notNull(),

    // Editability
    isSystemDefault: boolean('is_system_default').default(true),
    createdBy: uuid('created_by').references(() => profiles.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  table => ({
    uniqueAreaGrade: unique().on(table.competencyArea, table.grade),
  })
);
