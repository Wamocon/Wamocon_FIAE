-- ============================================================================
-- ARBEITSZEUGNIS MODULE - Database Schema
-- ============================================================================
-- Purpose: Weekly performance tracking and automatic work certificate generation
-- Author: Implementation Plan - Maanik Garg
-- Date: 2026-02-06
-- ============================================================================

-- --- ENUMS ---

-- Performance rating scale (German grading system 1-6)
CREATE TYPE performance_rating AS ENUM ('1', '2', '3', '4', '5', '6');

-- Certificate status workflow
CREATE TYPE certificate_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ISSUED');

-- Competency areas (four main categories)
CREATE TYPE competency_area AS ENUM (
  'FACHKOMPETENZ',        -- Technical competency
  'METHODENKOMPETENZ',    -- Methodological competency
  'SOZIALKOMPETENZ',      -- Social competency
  'PERSONALKOMPETENZ'     -- Personal competency
);

-- --- MASTER DATA TABLES ---

-- MES Softskill Criteria (19 criteria from MES system)
CREATE TABLE mes_softskill_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- e.g., "K3.1", "K4.2"
  name TEXT NOT NULL, -- e.g., "Teamfähigkeit", "Problemlösefähigkeit"
  description TEXT,
  k_level TEXT, -- K3, K4, or K5 (ISTQB cognitive levels)
  competency_area competency_area NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Ausbildungsrahmenplan (ARP) Themen
-- Already exists as trainingComponents and trainingUseCases tables
-- We'll reference those existing tables

-- --- WEEKLY EVALUATION TABLES ---

-- Weekly Performance Evaluations
CREATE TABLE weekly_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linking
  trainee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_report_id UUID REFERENCES activity_reports(id) ON DELETE CASCADE, -- Link to existing weekly reports

  -- Time period
  week_number INTEGER NOT NULL, -- ISO week 1-52
  year INTEGER NOT NULL, -- Calendar year
  ausbildungsjahr INTEGER NOT NULL, -- Training year 1, 2, or 3

  -- ARP Theme Selection (from existing trainingUseCases)
  arp_use_case_id UUID REFERENCES training_use_cases(id),
  arp_theme_text TEXT, -- Manual theme entry if not from dropdown

  -- Trainee Self-Assessment
  self_rating performance_rating,
  self_comment TEXT, -- Max 500 characters
  self_submitted_at TIMESTAMP,

  -- Trainer Assessment
  trainer_rating performance_rating NOT NULL,
  trainer_comment TEXT, -- Max 500 characters
  trainer_approved_at TIMESTAMP,

  -- Workflow status
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, APPROVED, REJECTED
  rejection_reason TEXT,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_trainee_week_year UNIQUE(trainee_id, week_number, year)
);

-- Softskill Weekly Ratings (19 criteria per week)
CREATE TABLE weekly_softskill_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  weekly_evaluation_id UUID NOT NULL REFERENCES weekly_evaluations(id) ON DELETE CASCADE,
  softskill_criterion_id UUID NOT NULL REFERENCES mes_softskill_criteria(id) ON DELETE CASCADE,

  -- Ratings
  self_rating performance_rating, -- Trainee self-assessment
  trainer_rating performance_rating NOT NULL, -- Trainer assessment (mandatory)

  trainer_comment TEXT, -- Optional comment on this specific skill

  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_evaluation_criterion UNIQUE(weekly_evaluation_id, softskill_criterion_id)
);

-- --- ANNUAL REVIEW TABLES ---

-- Annual Performance Summary
CREATE TABLE annual_performance_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trainee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ausbildungsjahr INTEGER NOT NULL, -- 1, 2, or 3
  year INTEGER NOT NULL, -- Calendar year

  -- Competency Area Averages (automatically calculated)
  fachkompetenz_avg REAL, -- Technical competency average
  methodenkompetenz_avg REAL, -- Methodological competency average
  sozialkompetenz_avg REAL, -- Social competency average
  personalkompetenz_avg REAL, -- Personal competency average

  overall_average REAL, -- Overall grade average across all areas

  -- Statistical data
  total_weeks_evaluated INTEGER DEFAULT 0,
  evaluation_completion_rate REAL, -- Percentage of weeks evaluated

  -- Warning flags
  below_cutoff_warning BOOLEAN DEFAULT FALSE, -- True if avg < 2.45 (shortening requirement)

  -- Annual Discussion
  discussion_date TIMESTAMP,
  discussion_summary TEXT, -- Trainer's summary of annual discussion
  discussion_conducted_by UUID REFERENCES profiles(id),
  trainee_statement TEXT, -- Trainee's statement/response

  -- Status
  is_finalized BOOLEAN DEFAULT FALSE,
  finalized_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_trainee_year UNIQUE(trainee_id, ausbildungsjahr, year)
);

-- --- WORK CERTIFICATE TABLES ---

-- Work Certificates (Arbeitszeugnisse)
CREATE TABLE work_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trainee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  annual_summary_id UUID REFERENCES annual_performance_summaries(id) ON DELETE SET NULL,

  -- Certificate metadata
  certificate_type TEXT NOT NULL DEFAULT 'INTERIM', -- INTERIM (Zwischenzeugnis), FINAL (Endzeugnis)
  issue_date DATE NOT NULL,

  -- Period covered
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  ausbildungsjahr INTEGER NOT NULL,

  -- Generated content
  generated_text TEXT NOT NULL, -- Auto-generated based on grades
  custom_summary TEXT, -- Trainer's mandatory summary (max 2000 chars) - PFLICHTFELD

  -- Competency ratings (from annual summary)
  fachkompetenz_grade performance_rating,
  methodenkompetenz_grade performance_rating,
  sozialkompetenz_grade performance_rating,
  personalkompetenz_grade performance_rating,

  -- PDF storage
  pdf_url TEXT, -- Supabase storage URL
  pdf_generated_at TIMESTAMP,

  -- Approval workflow
  status certificate_status DEFAULT 'DRAFT',
  approved_by_trainer_id UUID REFERENCES profiles(id),
  approved_at TIMESTAMP,

  -- Digital signatures
  trainee_signed_at TIMESTAMP,
  trainer_signed_at TIMESTAMP,

  -- Locking mechanism (once issued, cannot be edited)
  is_locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Certificate Text Templates (Standard phrases per grade)
CREATE TABLE certificate_text_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  competency_area competency_area NOT NULL,
  grade performance_rating NOT NULL,

  -- Template texts (German legal phrasing)
  template_text TEXT NOT NULL,

  -- Editability
  is_system_default BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),

  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_area_grade UNIQUE(competency_area, grade)
);

-- --- INDEXES for Performance ---

CREATE INDEX idx_weekly_evals_trainee ON weekly_evaluations(trainee_id);
CREATE INDEX idx_weekly_evals_year ON weekly_evaluations(year, ausbildungsjahr);
CREATE INDEX idx_weekly_evals_status ON weekly_evaluations(status);
CREATE INDEX idx_weekly_evals_report ON weekly_evaluations(activity_report_id);

CREATE INDEX idx_softskill_ratings_eval ON weekly_softskill_ratings(weekly_evaluation_id);

CREATE INDEX idx_annual_summaries_trainee ON annual_performance_summaries(trainee_id);
CREATE INDEX idx_annual_summaries_year ON annual_performance_summaries(ausbildungsjahr, year);
CREATE INDEX idx_annual_summaries_warning ON annual_performance_summaries(below_cutoff_warning);

CREATE INDEX idx_certificates_trainee ON work_certificates(trainee_id);
CREATE INDEX idx_certificates_status ON work_certificates(status);
CREATE INDEX idx_certificates_date ON work_certificates(issue_date);

-- --- SEED DATA for MES Softskill Criteria ---

INSERT INTO mes_softskill_criteria (code, name, description, k_level, competency_area, order_index) VALUES
-- K3 Level (Anwenden)
('K3.1', 'Teamfähigkeit', 'Kooperatives Arbeiten im Team', 'K3', 'SOZIALKOMPETENZ', 1),
('K3.2', 'Kommunikationsfähigkeit', 'Effektive mündliche und schriftliche Kommunikation', 'K3', 'SOZIALKOMPETENZ', 2),
('K3.3', 'Zeitmanagement', 'Effiziente Planung und Einhaltung von Terminen', 'K3', 'METHODENKOMPETENZ', 3),
('K3.4', 'Zuverlässigkeit', 'Verlässlichkeit bei der Aufgabenerfüllung', 'K3', 'PERSONALKOMPETENZ', 4),
('K3.5', 'Selbstständigkeit', 'Eigenverantwortliches Arbeiten', 'K3', 'PERSONALKOMPETENZ', 5),
('K3.6', 'Sorgfalt', 'Gewissenhafte und präzise Arbeitsweise', 'K3', 'FACHKOMPETENZ', 6),

-- K4 Level (Analysieren)
('K4.1', 'Problemlösefähigkeit', 'Systematische Problemanalyse und Lösungsfindung', 'K4', 'METHODENKOMPETENZ', 7),
('K4.2', 'Analytisches Denken', 'Zerlegung komplexer Probleme in Teilaspekte', 'K4', 'METHODENKOMPETENZ', 8),
('K4.3', 'Lernbereitschaft', 'Offenheit für neue Technologien und Methoden', 'K4', 'PERSONALKOMPETENZ', 9),
('K4.4', 'Kreativität', 'Entwicklung innovativer Lösungsansätze', 'K4', 'METHODENKOMPETENZ', 10),
('K4.5', 'Stressresistenz', 'Gelassenheit und Leistungsfähigkeit unter Druck', 'K4', 'PERSONALKOMPETENZ', 11),
('K4.6', 'Konfliktfähigkeit', 'Konstruktiver Umgang mit Meinungsverschiedenheiten', 'K4', 'SOZIALKOMPETENZ', 12),
('K4.7', 'Kritikfähigkeit', 'Annahme und Umsetzung von Feedback', 'K4', 'PERSONALKOMPETENZ', 13),

-- K5 Level (Bewerten)
('K5.1', 'Entscheidungsfähigkeit', 'Treffen begründeter Entscheidungen', 'K5', 'METHODENKOMPETENZ', 14),
('K5.2', 'Kundenorientierung', 'Verständnis und Berücksichtigung von Kundenanforderungen', 'K5', 'SOZIALKOMPETENZ', 15),
('K5.3', 'Verantwortungsbewusstsein', 'Übernahme von Verantwortung für Ergebnisse', 'K5', 'PERSONALKOMPETENZ', 16),
('K5.4', 'Qualitätsbewusstsein', 'Streben nach hoher Arbeitsqualität', 'K5', 'FACHKOMPETENZ', 17),
('K5.5', 'Initiative', 'Proaktives Handeln und Eigeninitiative', 'K5', 'PERSONALKOMPETENZ', 18),
('K5.6', 'Führungsqualitäten', 'Fähigkeit zur Koordination und Motivation', 'K5', 'SOZIALKOMPETENZ', 19);

-- --- SEED DATA for Certificate Text Templates ---
-- (Sample templates - these should be reviewed and customized by legal/HR)

INSERT INTO certificate_text_templates (competency_area, grade, template_text, is_system_default) VALUES
-- Fachkompetenz templates
('FACHKOMPETENZ', '1', 'Herr/Frau [Name] verfügt über hervorragende fachliche Kenntnisse und Fähigkeiten. Die Aufgaben wurden stets zur vollsten Zufriedenheit erledigt.', TRUE),
('FACHKOMPETENZ', '2', 'Herr/Frau [Name] verfügt über sehr gute fachliche Kenntnisse und Fähigkeiten. Die Aufgaben wurden stets zur vollen Zufriedenheit erledigt.', TRUE),
('FACHKOMPETENZ', '3', 'Herr/Frau [Name] verfügt über gute fachliche Kenntnisse und Fähigkeiten. Die Aufgaben wurden zur Zufriedenheit erledigt.', TRUE),
('FACHKOMPETENZ', '4', 'Herr/Frau [Name] verfügt über zufriedenstellende fachliche Kenntnisse und Fähigkeiten. Die Aufgaben wurden im Wesentlichen ordnungsgemäß erledigt.', TRUE),
('FACHKOMPETENZ', '5', 'Herr/Frau [Name] verfügt über ausreichende fachliche Kenntnisse. Die Aufgaben wurden mit Anleitung erledigt.', TRUE),
('FACHKOMPETENZ', '6', 'Herr/Frau [Name] zeigte Bemühungen, die gestellten Anforderungen zu erfüllen.', TRUE),

-- Sozialkompetenz templates
('SOZIALKOMPETENZ', '1', 'Das Verhalten gegenüber Vorgesetzten und Kollegen war stets vorbildlich und durch besondere Hilfsbereitschaft geprägt.', TRUE),
('SOZIALKOMPETENZ', '2', 'Das Verhalten gegenüber Vorgesetzten und Kollegen war stets einwandfrei und sehr kooperativ.', TRUE),
('SOZIALKOMPETENZ', '3', 'Das Verhalten gegenüber Vorgesetzten und Kollegen war einwandfrei.', TRUE),
('SOZIALKOMPETENZ', '4', 'Das Verhalten gegenüber Vorgesetzten und Kollegen war im Allgemeinen angemessen.', TRUE),
('SOZIALKOMPETENZ', '5', 'Das Verhalten gegenüber Vorgesetzten und Kollegen gab grundsätzlich keinen Anlass zur Beanstandung.', TRUE),
('SOZIALKOMPETENZ', '6', 'Das Verhalten gegenüber Vorgesetzten und Kollegen entsprach den Erwartungen.', TRUE);

-- Additional templates for METHODENKOMPETENZ and PERSONALKOMPETENZ would follow the same pattern...

COMMENT ON TABLE weekly_evaluations IS 'Wöchentliche Leistungsbewertungen für das Arbeitszeugnis-Modul';
COMMENT ON TABLE work_certificates IS 'Generierte Arbeitszeugnisse mit PDF-Export';
COMMENT ON TABLE mes_softskill_criteria IS 'MES Softskill-Kriterienkatalog (19 Kriterien)';
