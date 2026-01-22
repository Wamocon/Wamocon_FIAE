-- Migration to fix Storage Policies for 'content' bucket
-- This ensures trainers can upload PDFs for Enablers and Use Cases

-- 1. Ensure 'content' bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('content', 'content', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Enable RLS on objects (standard practice)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Allow authenticated users to upload to their own folder
-- Path pattern: {user_id}/{timestamp}_{filename}
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
CREATE POLICY "Allow authenticated uploads" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (
    bucket_id = 'content' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Policy: Allow authenticated users to view all content files
-- (Needed so trainees can view PDFs uploaded by trainers)
DROP POLICY IF EXISTS "Allow authenticated viewing" ON storage.objects;
CREATE POLICY "Allow authenticated viewing" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'content');

-- 5. Policy: Allow users to delete their own files
DROP POLICY IF EXISTS "Allow users to delete own files" ON storage.objects;
CREATE POLICY "Allow users to delete own files" ON storage.objects
FOR DELETE 
TO authenticated
USING (
    bucket_id = 'content' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
