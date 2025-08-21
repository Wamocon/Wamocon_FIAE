import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Profile {
  id: string
  full_name: string
  role: 'trainee' | 'trainer'
  avatar_url?: string
  trainer_id?: string
  training_start_date?: string
  created_at: string
  updated_at: string
}

export interface Module {
  id: string
  title: string
  training_year: number
  description?: string
  created_at: string
  updated_at: string
}

export interface Chapter {
  id: string
  module_id: string
  title: string
  description?: string
  order_index: number
  created_at: string
  updated_at: string
}

export interface Lesson {
  id: string
  chapter_id: string
  title: string
  content?: string
  type: 'lesson' | 'exercise' | 'quiz'
  order_index: number
  created_at: string
  updated_at: string
}

export interface Quiz {
  id: string
  title: string
  description?: string
  time_limit?: number
  passing_score: number
  created_at: string
  updated_at: string
}

export interface QuizSubmission {
  id: string
  quiz_id: string
  trainee_id: string
  score: number
  status: 'submitted' | 'reviewed'
  feedback?: string
  submitted_at: string
  reviewed_at?: string
}

// Mock data for development (when Supabase is not fully set up)
export const mockData = {
  profiles: {
    trainee: { 
      id: 'trainee_1', 
      full_name: 'Elias Felsing', 
      role: 'trainee' as const, 
      avatar_url: 'https://placehold.co/100x100/7c3aed/ffffff?text=E', 
      trainer_id: 'trainer_1', 
      training_start_date: '2025-08-01' 
    },
    trainer: { 
      id: 'trainer_1', 
      full_name: 'Waleri Moretz', 
      role: 'trainer' as const, 
      avatar_url: 'https://placehold.co/100x100/1d4ed8/ffffff?text=W' 
    }
  },
  curriculum: [
    { 
      moduleId: 'mod_1', 
      training_year: 1, 
      title: 'Grundlagen der Anwendungsentwicklung', 
      progress: 75,
      chapters: [
        { 
          chapterId: 'chap_1_1', 
          title: 'Einführung in die Programmierung',
          lessons: [
            { id: 'les_1_1_1', title: 'Was ist eine Programmiersprache?', type: 'lesson', completed: true, ref: '§4 Abs. 2 Nr. 1a' },
            { id: 'les_1_1_2', title: 'Quiz: Grundbegriffe', type: 'quiz', quizId: 'quiz_1_1_2', completed: true, ref: '§4 Abs. 2 Nr. 1a' },
            { id: 'les_1_1_3', title: 'Praxis: Dein erstes "Hello, World!"', type: 'exercise', completed: true, ref: '§4 Abs. 2 Nr. 1b' }
          ],
          mainQuizId: 'quiz_chap_1_1'
        },
        { 
          chapterId: 'chap_1_2', 
          title: 'Variablen und Datentypen',
          lessons: [
            { id: 'les_1_2_1', title: 'Variablen, Datentypen und Operatoren', type: 'lesson', completed: false, ref: '§4 Abs. 2 Nr. 1c' },
            { id: 'les_1_2_2', title: 'Quiz: Datentypen', type: 'quiz', quizId: 'quiz_1_2_2', completed: false, ref: '§4 Abs. 2 Nr. 1c' }
          ],
          mainQuizId: 'quiz_chap_1_2'
        }
      ]
    },
    { 
      moduleId: 'mod_2', 
      training_year: 1, 
      title: 'Projektmanagement und agile Methoden', 
      progress: 40,
      chapters: [ 
        { chapterId: 'chap_2_1', title: 'Einführung in Scrum', lessons: [], mainQuizId: 'quiz_chap_2_1' } 
      ]
    }
  ],
  quizSubmissions: [
    { submissionId: 'sub_1', quizId: 'quiz_1_1_2', quizTitle: 'Quiz: Grundbegriffe', traineeId: 'trainee_1', score: 90, status: 'reviewed' as const, feedback: 'Sehr gute Leistung! Die Grundlagen sitzen.', submitted_at: '2025-08-10T10:00:00Z' },
    { submissionId: 'sub_2', quizId: 'quiz_chap_1_1', quizTitle: 'Abschlusstest: Einführung', traineeId: 'trainee_1', score: 75, status: 'submitted' as const, feedback: null, submitted_at: '2025-08-12T14:30:00Z' }
  ],
  trainees: [
    { id: 'trainee_1', name: 'Elias Felsing', progress: 75, avatar: 'https://placehold.co/100x100/7c3aed/ffffff?text=E' },
    { id: 'trainee_2', name: 'Maanik Garg', progress: 90, avatar: 'https://placehold.co/100x100/16a34a/ffffff?text=M' },
    { id: 'trainee_3', name: 'Julia Schneider', progress: 50, avatar: 'https://placehold.co/100x100/16a34a/ffffff?text=J' },
  ]
}

// Mock quiz data for development
export const mockQuiz = {
  id: 'quiz_1_1_2',
  title: 'Quiz: Grundbegriffe der Programmierung',
  description: 'Teste dein Wissen über die Grundlagen der Programmierung',
  timeLimit: 300, // 5 minutes
  passingScore: 70,
  totalQuestions: 5,
  questions: [
    {
      id: 'q1',
      question: 'Was ist eine Programmiersprache?',
      options: [
        'Eine Sprache, die nur Computer verstehen',
        'Ein Werkzeug zur Kommunikation mit dem Computer',
        'Eine künstliche Sprache für Menschen',
        'Ein Betriebssystem'
      ],
      correctAnswer: 1
    },
    {
      id: 'q2',
      question: 'Welches ist KEIN Grundkonzept der Programmierung?',
      options: [
        'Variablen',
        'Schleifen',
        'Datenbanken',
        'Funktionen'
      ],
      correctAnswer: 2
    },
    {
      id: 'q3',
      question: 'Was bedeutet "Debugging"?',
      options: [
        'Programme schreiben',
        'Fehler in Programmen finden und beheben',
        'Programme kompilieren',
        'Programme testen'
      ],
      correctAnswer: 1
    },
    {
      id: 'q4',
      question: 'Welche Struktur wird verwendet, um Entscheidungen zu treffen?',
      options: [
        'Schleifen',
        'Bedingungen (if/else)',
        'Funktionen',
        'Variablen'
      ],
      correctAnswer: 1
    },
    {
      id: 'q5',
      question: 'Was ist der Zweck von Kommentaren im Code?',
      options: [
        'Den Code zu verstecken',
        'Den Code zu beschleunigen',
        'Den Code verständlich zu machen',
        'Den Code zu kompilieren'
      ],
      correctAnswer: 2
    }
  ]
}
