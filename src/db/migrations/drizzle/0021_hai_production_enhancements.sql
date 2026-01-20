-- ============================================================================
-- HAI.ai Migration 4: Production Enhancements
-- ============================================================================
-- Description: Adds triggers, constraints, and management functions
-- Features: Auto-update timestamps, message limits, session cleanup
-- ============================================================================

-- ============================================================================
-- 1. AUTO-UPDATE TRIGGER for updated_at columns
-- ============================================================================
-- Automatically updates the updated_at timestamp when a row is modified

CREATE OR REPLACE FUNCTION hai_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION hai_update_updated_at() IS 'Auto-updates updated_at timestamp on row changes';

-- Apply to hai_embeddings
DROP TRIGGER IF EXISTS hai_embeddings_updated_at ON hai_embeddings;
CREATE TRIGGER hai_embeddings_updated_at
    BEFORE UPDATE ON hai_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION hai_update_updated_at();

-- Apply to hai_chat_sessions
DROP TRIGGER IF EXISTS hai_chat_sessions_updated_at ON hai_chat_sessions;
CREATE TRIGGER hai_chat_sessions_updated_at
    BEFORE UPDATE ON hai_chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION hai_update_updated_at();

-- ============================================================================
-- 2. MESSAGE COUNT LIMIT TRIGGER
-- ============================================================================
-- Keeps maximum 100 messages per session, auto-deletes oldest when exceeded
-- This prevents unbounded growth while maintaining conversation history

CREATE OR REPLACE FUNCTION hai_enforce_message_limit()
RETURNS TRIGGER AS $$
DECLARE
    message_count INTEGER;
    messages_to_delete INTEGER;
BEGIN
    -- Count messages in this session
    SELECT COUNT(*) INTO message_count
    FROM hai_chat_messages
    WHERE session_id = NEW.session_id;
    
    -- If over 100 messages, delete oldest ones (keep last 100)
    IF message_count > 100 THEN
        messages_to_delete := message_count - 100;
        
        DELETE FROM hai_chat_messages
        WHERE id IN (
            SELECT id FROM hai_chat_messages
            WHERE session_id = NEW.session_id
            ORDER BY created_at ASC
            LIMIT messages_to_delete
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION hai_enforce_message_limit() IS 'Keeps max 100 messages per session, deletes oldest';

DROP TRIGGER IF EXISTS hai_messages_limit_check ON hai_chat_messages;
CREATE TRIGGER hai_messages_limit_check
    AFTER INSERT ON hai_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION hai_enforce_message_limit();

-- ============================================================================
-- 3. SESSION DEACTIVATION FUNCTION
-- ============================================================================
-- Deactivates sessions that have been inactive for 24+ hours
-- Call this manually or via pg_cron: SELECT hai_deactivate_old_sessions();

CREATE OR REPLACE FUNCTION hai_deactivate_old_sessions()
RETURNS INTEGER AS $$
DECLARE
    deactivated_count INTEGER;
BEGIN
    WITH deactivated AS (
        UPDATE hai_chat_sessions
        SET is_active = false
        WHERE is_active = true
        AND updated_at < NOW() - INTERVAL '24 hours'
        RETURNING id
    )
    SELECT COUNT(*) INTO deactivated_count FROM deactivated;
    
    RETURN deactivated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION hai_deactivate_old_sessions() IS 'Deactivates sessions inactive for 24+ hours. Returns count of deactivated sessions.';

-- ============================================================================
-- 4. CONTENT LENGTH CONSTRAINT
-- ============================================================================
-- Prevents excessively long messages (max 10,000 characters)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage 
        WHERE constraint_name = 'hai_messages_content_length'
    ) THEN
        ALTER TABLE hai_chat_messages
        ADD CONSTRAINT hai_messages_content_length 
        CHECK (char_length(content) <= 10000);
    END IF;
END $$;

-- ============================================================================
-- 5. INDEX FOR ARCHIVAL
-- ============================================================================
-- Speeds up queries for finding old sessions that need archiving

CREATE INDEX IF NOT EXISTS idx_hai_sessions_updated 
    ON hai_chat_sessions(updated_at) 
    WHERE is_active = true;
