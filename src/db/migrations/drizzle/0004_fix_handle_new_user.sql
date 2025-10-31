-- Replace the auth signup trigger function to match our current `profiles` schema
-- This function ensures the profiles row is created with `id` equal to auth.users.id
-- and uses fully-qualified names and a fixed search_path for safety.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Create or update profile for newly created auth user. Use id column (PK) to match auth.users.id.
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(UPPER(NEW.raw_user_meta_data->>'role'), 'TRAINEE')::public.user_role,
    CASE WHEN LOWER(COALESCE(NEW.raw_user_meta_data->>'role','trainee')) = 'trainer' THEN true ELSE false END,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

  RETURN NEW;
END;
$$;
