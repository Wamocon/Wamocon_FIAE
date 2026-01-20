-- ============================================================================
-- HAI.ai Migration 5: Row Level Security (RLS) Policies
-- ============================================================================
-- Description: Configures security policies for data access control
-- Features: User isolation, trainer access, service role bypass
-- ============================================================================

-- ============================================================================
-- 1. ENABLE RLS ON ALL HAI TABLES
-- ============================================================================

ALTER TABLE hai_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hai_chat_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. HAI_EMBEDDINGS POLICIES
-- ============================================================================
-- Embeddings are public read (everyone can search them)
-- Only service role can write (for indexing)

DROP POLICY IF EXISTS hai_embeddings_read_all ON hai_embeddings;
CREATE POLICY hai_embeddings_read_all ON hai_embeddings
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS hai_embeddings_service_role ON hai_embeddings;
CREATE POLICY hai_embeddings_service_role ON hai_embeddings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 3. HAI_CHAT_SESSIONS POLICIES
-- ============================================================================
-- Users can only see their own sessions
-- Trainers can view all sessions (for admin/analytics)
-- Service role has full access (for API routes)

DROP POLICY IF EXISTS hai_sessions_user_policy ON hai_chat_sessions;
CREATE POLICY hai_sessions_user_policy ON hai_chat_sessions
    FOR ALL
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS hai_sessions_trainer_view ON hai_chat_sessions;
CREATE POLICY hai_sessions_trainer_view ON hai_chat_sessions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'TRAINER'
        )
    );

DROP POLICY IF EXISTS hai_sessions_service_role ON hai_chat_sessions;
CREATE POLICY hai_sessions_service_role ON hai_chat_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 4. HAI_CHAT_MESSAGES POLICIES
-- ============================================================================
-- Users can only see messages from their own sessions
-- Trainers can view all messages (for admin/analytics)
-- Service role has full access (for API routes)

DROP POLICY IF EXISTS hai_messages_user_policy ON hai_chat_messages;
CREATE POLICY hai_messages_user_policy ON hai_chat_messages
    FOR ALL
    USING (
        session_id IN (
            SELECT id FROM hai_chat_sessions WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS hai_messages_trainer_view ON hai_chat_messages;
CREATE POLICY hai_messages_trainer_view ON hai_chat_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM hai_chat_sessions hs
            JOIN profiles p ON p.id = auth.uid()
            WHERE hs.id = hai_chat_messages.session_id
            AND p.role = 'TRAINER'
        )
    );

DROP POLICY IF EXISTS hai_messages_service_role ON hai_chat_messages;
CREATE POLICY hai_messages_service_role ON hai_chat_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE tablename LIKE 'hai_%';
    
    IF policy_count < 8 THEN
        RAISE EXCEPTION 'Expected at least 8 HAI policies, found %', policy_count;
    END IF;
    
    RAISE NOTICE 'HAI.ai RLS setup complete: % policies configured', policy_count;
END $$;
