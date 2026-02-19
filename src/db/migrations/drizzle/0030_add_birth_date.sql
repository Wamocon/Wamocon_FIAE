-- Migration: Add birth_date field to profiles table
-- Date: 2026-02-13
-- Description: Adds birth_date column to track trainee dates of birth for certificates

ALTER TABLE profiles ADD COLUMN birth_date timestamp NULL;

-- Create an index on birth_date for better query performance
CREATE INDEX idx_profiles_birth_date ON profiles(birth_date) WHERE birth_date IS NOT NULL;
