-- 1. Drop the old trigger and function (to start fresh)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

--
-- 2. CREATE THE NEW, CORRECTED FUNCTION
--
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
AS $$
BEGIN
  -- Insert a new row into your 'profiles' table
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    role,
    -- We explicitly add these to prevent NOT NULL errors
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'role', 'trainee')::public.user_role,
    -- Provide default values
    true,
    NOW(),
    NOW()
  )
  -- This part prevents errors if the user already exists
  ON CONFLICT (id) DO
  UPDATE SET
    email = NEW.email,
    full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    avatar_url = NEW.raw_user_meta_data->>'avatar_url',
    updated_at = NOW();

  RETURN NEW;
END;
$$
-- This part is critical for hosted Supabase to fix permission errors
LANGUAGE plpgsql SECURITY DEFINER;

--
-- 3. CREATE THE TRIGGER
--
CREATE TRIGGER on_auth_user_created
  -- This fires AFTER a new user is added to auth.users
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();