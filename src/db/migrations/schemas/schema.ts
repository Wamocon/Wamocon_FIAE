import { pgTable, uuid, text, integer, timestamp, date, pgEnum, boolean } from "drizzle-orm/pg-core";

// ==========================
// ENUMS
// ==========================
export const userRole = pgEnum("user_role", ["trainee", "trainer"]);
export const quizType = pgEnum("quiz_type", ["mini", "big"]);
export const questionType = pgEnum("question_type", ["multiple_choice", "true_false", "short_answer"]);
export const submissionStatus = pgEnum("submission_status", ["pending", "approved", "rejected"]);

// ==========================
// PROFILES
// ==========================
export const profiles = pgTable("profiles", {
    id: uuid("id").primaryKey().defaultRandom(),      // local PK
    auth_id: uuid("auth_id").notNull().unique(),      // FK to Supabase auth.users.id
    full_name: text("full_name").notNull(),
    role: userRole("role").default("trainee"),
    avatar_url: text("avatar_url"),
    trainer_auth_id: text(),
    training_start_date: date("training_start_date"),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
export type Profile = typeof profiles.$inferSelect;

// ==========================
// MODULES
// ==========================
export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  training_year: integer("training_year").notNull(),
  order_index: integer("order_index").notNull(),
  duration_days: integer("duration_days").default(365),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Module = typeof modules.$inferSelect;

// ==========================
// LESSONS
// ==========================
export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  module_id: uuid("module_id").notNull().references(() => modules.id),
  rahmenplan_reference_code: text("rahmenplan_reference_code"),
  title: text("title").notNull(),
  order_index: integer("order_index").notNull(),
  duration_weeks: integer("duration_weeks").default(3),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Lesson = typeof lessons.$inferSelect;

// ==========================
// SUB-LESSONS
// ==========================
export const subLessons = pgTable("sub_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  lesson_id: uuid("lesson_id").notNull().references(() => lessons.id),
  title: text("title").notNull(),
  content: text("content"),
  exercise_prompt: text("exercise_prompt"),
  exercise_solution: text("exercise_solution"),
  order_index: integer("order_index").notNull(),
  duration_minutes: integer("duration_minutes").default(30),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type SubLesson = typeof subLessons.$inferSelect;

// ==========================
// PROGRESS
// ==========================
export const progress = pgTable("progress", {
  user_id: uuid("user_id").references(() => profiles.id),
  sub_lesson_id: uuid("sub_lesson_id").references(() => subLessons.id),
  completed_at: timestamp("completed_at"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => ({
  primaryKey: [table.user_id, table.sub_lesson_id],
}));
export type Progress = typeof progress.$inferSelect;

// ==========================
// QUIZZES
// ==========================
export const quizzes = pgTable("quizzes", {
  id: uuid("id").primaryKey().defaultRandom(),
  quiz_type: quizType("quiz_type").notNull(),
  title: text("title").notNull(),
  lesson_id: uuid("lesson_id").references(() => lessons.id),
  module_id: uuid("module_id").references(() => modules.id),
  training_year: integer("training_year").notNull(),
  time_limit_minutes: integer("time_limit_minutes").default(30),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Quiz = typeof quizzes.$inferSelect;

// ==========================
// QUESTIONS
// ==========================
export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  quiz_id: uuid("quiz_id").notNull().references(() => quizzes.id),
  question_text: text("question_text").notNull(),
  question_type: questionType("question_type").notNull(),
  order_index: integer("order_index").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Question = typeof questions.$inferSelect;

// ==========================
// OPTIONS
// ==========================
export const options = pgTable("options", {
  id: uuid("id").primaryKey().defaultRandom(),
  question_id: uuid("question_id").notNull().references(() => questions.id),
  option_text: text("option_text").notNull(),
  is_correct: boolean("is_correct").notNull().default(false),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Option = typeof options.$inferSelect;

// ==========================
// QUIZ SUBMISSIONS
// ==========================
export const quizSubmissions = pgTable("quiz_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => profiles.id),
  quiz_id: uuid("quiz_id").notNull().references(() => quizzes.id),
  score: integer("score"),
  submitted_at: timestamp("submitted_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  created_by: uuid("created_by"),
});
export type QuizSubmission = typeof quizSubmissions.$inferSelect;

// ==========================
// SUBMISSION ANSWERS
// ==========================
export const submissionAnswers = pgTable("submission_answers", {
  submission_id: uuid("submission_id").references(() => quizSubmissions.id),
  question_id: uuid("question_id").references(() => questions.id),
  selected_option_id: uuid("selected_option_id").references(() => options.id),
  created_at: timestamp("created_at").defaultNow(),
  created_by: uuid("created_by"),
}, (table) => ({
  primaryKey: [table.submission_id, table.question_id],
}));
export type SubmissionAnswer = typeof submissionAnswers.$inferSelect;

// ==========================
// KNOWLEDGE SUBMISSIONS
// ==========================
export const knowledgeSubmissions = pgTable("knowledge_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => profiles.id),
  title: text("title").notNull(),
  description: text("description"),
  file_url: text("file_url"),
  status: submissionStatus("status").default("pending"),
  reviewer_notes: text("reviewer_notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type KnowledgeSubmission = typeof knowledgeSubmissions.$inferSelect;

// ==========================
// REFLECTIONS
// ==========================
export const reflections = pgTable("reflections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => profiles.id),
  due_date: date("due_date"),
  swot_strengths: text("swot_strengths"),
  swot_weaknesses: text("swot_weaknesses"),
  swot_opportunities: text("swot_opportunities"),
  swot_threats: text("swot_threats"),
  mes_status: text("mes_status"),
  submitted_at: timestamp("submitted_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type Reflection = typeof reflections.$inferSelect;

// ==========================
// TESTIMONIALS
// ==========================
export const testimonials = pgTable("testimonials", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => profiles.id),
  milestone: text("milestone").notNull(),
  feedback_text: text("feedback_text"),
  submitted_at: timestamp("submitted_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  created_by: uuid("created_by"),
});
export type Testimonial = typeof testimonials.$inferSelect;

// ==========================
// ACCEPTANCE PROTOCOLS
// ==========================
export const acceptanceProtocols = pgTable("acceptance_protocols", {
  id: uuid("id").primaryKey().defaultRandom(),
  trainee_id: uuid("trainee_id").notNull().references(() => profiles.id),
  trainer_id: uuid("trainer_id").notNull().references(() => profiles.id),
  milestone_name: text("milestone_name").notNull(),
  comments: text("comments"),
  protocol_pdf_url: text("protocol_pdf_url"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  created_by: uuid("created_by"),
  modified_by: uuid("modified_by"),
});
export type AcceptanceProtocol = typeof acceptanceProtocols.$inferSelect;

// drop a trigger
// -- 1️⃣ Drop the trigger
// DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

// -- 2️⃣ Now drop the function
// DROP FUNCTION IF EXISTS handle_new_user();
