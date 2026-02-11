-- Migration: 0027_arbeitszeugnis_grades.sql
-- Date: 2026-02-09
-- Description: Add grading fields to activity_report_use_case_entries and 
--              snapshot/QR/gender fields to work_certificates for Arbeitszeugnis module

-- =====================================================
-- ADD GRADING FIELDS TO ACTIVITY REPORT USE CASE ENTRIES
-- =====================================================
-- These fields allow trainers to grade individual use cases within activity reports
-- The grades are then aggregated to generate the Arbeitszeugnis

ALTER TABLE activity_report_use_case_entries
ADD COLUMN IF NOT EXISTS trainer_grade performance_rating,
ADD COLUMN IF NOT EXISTS grade_comment TEXT,
ADD COLUMN IF NOT EXISTS is_grade_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS grade_approved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS grade_approved_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN activity_report_use_case_entries.trainer_grade IS 'Trainer grade 1-6 for this use case entry';
COMMENT ON COLUMN activity_report_use_case_entries.is_grade_approved IS 'Whether the grade has been finalized by trainer';

-- =====================================================
-- ADD SNAPSHOT/QR/GENDER FIELDS TO WORK CERTIFICATES  
-- =====================================================
-- snapshotData: Frozen grades at certificate issue (prevents retroactive changes)
-- qrVerificationCode: Unique code for certificate authenticity verification
-- gender: For gender-neutral pronoun generation

ALTER TABLE work_certificates
ADD COLUMN IF NOT EXISTS snapshot_data JSONB,
ADD COLUMN IF NOT EXISTS qr_verification_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS qr_verification_url TEXT,
ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'neutral';

COMMENT ON COLUMN work_certificates.snapshot_data IS 'Frozen grades/component data at certificate issue time (immutable state per §126a BGB)';
COMMENT ON COLUMN work_certificates.qr_verification_code IS 'Unique verification code for QR authentication';
COMMENT ON COLUMN work_certificates.gender IS 'Pronoun gender: male, female, or neutral';

-- =====================================================
-- CREATE CERTIFICATE TEMPLATES FOR IHK GRADE DESCRIPTIONS
-- =====================================================
-- IHK Notensystem Legend (to be displayed in PDF)
-- 1 = Sehr gut (92-100%) - entspricht den Anforderungen in besonderem Maße
-- 2 = Gut (81-91%) - entspricht den Anforderungen voll
-- 3 = Befriedigend (67-80%) - entspricht den Anforderungen im Allgemeinen
-- 4 = Ausreichend (50-66%) - weist Mängel auf, entspricht aber noch den Anforderungen
-- 5 = Mangelhaft (30-49%) - entspricht nicht den Anforderungen, Grundkenntnisse vorhanden
-- 6 = Ungenügend (0-29%) - entspricht nicht den Anforderungen, Grundkenntnisse nicht ausreichend

-- Create grade legend table for reference
CREATE TABLE IF NOT EXISTS ihk_grade_legend (
  grade performance_rating PRIMARY KEY,
  description_de TEXT NOT NULL,
  description_en TEXT NOT NULL,
  point_range_min INTEGER NOT NULL,
  point_range_max INTEGER NOT NULL
);

-- Insert grade definitions
INSERT INTO ihk_grade_legend (grade, description_de, description_en, point_range_min, point_range_max)
VALUES 
  ('1', 'Sehr gut – entspricht den Anforderungen in besonderem Maße', 'Very Good – meets requirements to an exceptional degree', 92, 100),
  ('2', 'Gut – entspricht den Anforderungen voll', 'Good – fully meets requirements', 81, 91),
  ('3', 'Befriedigend – entspricht den Anforderungen im Allgemeinen', 'Satisfactory – generally meets requirements', 67, 80),
  ('4', 'Ausreichend – weist Mängel auf, entspricht aber im Ganzen noch den Anforderungen', 'Sufficient – has deficiencies but still meets requirements overall', 50, 66),
  ('5', 'Mangelhaft – entspricht nicht den Anforderungen, Grundkenntnisse sind vorhanden', 'Deficient – does not meet requirements, basic knowledge present', 30, 49),
  ('6', 'Ungenügend – entspricht nicht den Anforderungen, Grundkenntnisse nicht ausreichend', 'Unsatisfactory – does not meet requirements, basic knowledge insufficient', 0, 29)
ON CONFLICT (grade) DO NOTHING;
