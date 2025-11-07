// User and Authentication Types
export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: 'trainee' | 'trainer';
  avatar_url?: string;
  trainer_id?: string;
  training_start_date?: string;
  created_at: string;
  updated_at: string;
}

// Learning Content Types
export interface Module {
  id: string;
  title: string;
  description?: string;
  training_year: number;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  module_id: string;
  title: string;
  description?: string;
  order_index: number;
  lessons: Lesson[];
  main_quiz_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  chapter_id: string;
  title: string;
  content: string;
  type: 'lesson' | 'exercise' | 'quiz';
  reference?: string;
  order_index: number;
  completed: boolean;
  quiz_id?: string;
  created_at: string;
  updated_at: string;
}

// Quiz and Assessment Types
export interface Quiz {
  id: string;
  lesson_id?: string;
  chapter_id?: string;
  title: string;
  questions: QuizQuestion[];
  time_limit?: number;
  passing_score: number;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation?: string;
}

export interface QuizSubmission {
  id: string;
  quiz_id: string;
  trainee_id: string;
  score: number;
  answers: Record<string, number>;
  status: 'submitted' | 'reviewed';
  feedback?: string;
  submitted_at: string;
  reviewed_at?: string;
}

// Dashboard and UI Types
export interface DashboardStats {
  totalModules: number;
  completedModules: number;
  totalLessons: number;
  completedLessons: number;
  averageProgress: number;
  upcomingDeadlines: number;
}

export interface NavigationItem {
  label: string;
  icon: string;
  view: string;
  badge?: number;
}

export interface Breadcrumb {
  title: string;
  view: string;
  data?: unknown;
}

// Form and Input Types
export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'textarea' | 'select' | 'date';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Notification and Alert Types
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action_url?: string;
}

// File and Media Types
export interface FileUpload {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploaded_at: string;
  uploaded_by: string;
}

// Settings and Configuration Types
export interface UserSettings {
  language: 'de' | 'en';
  theme: 'dark' | 'light';
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  privacy: {
    profile_visible: boolean;
    progress_visible: boolean;
  };
}
