-- Add exam_part column to courses table
-- Values: 1 = Abschlussprüfung Teil 1, 2 = Abschlussprüfung Teil 2, NULL = not assigned

ALTER TABLE courses ADD COLUMN IF NOT EXISTS exam_part INTEGER;

-- Optional: Add a comment for documentation
COMMENT ON COLUMN courses.exam_part IS 'Abschlussprüfung Teil: 1 = Teil 1, 2 = Teil 2';
