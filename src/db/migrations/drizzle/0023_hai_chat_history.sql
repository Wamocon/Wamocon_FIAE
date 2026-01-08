-- ============================================================================
-- HAI.ai Migration 6: Chat History Enhancements
-- ============================================================================
-- Purpose: Enable ChatGPT/Gemini-like chat history with resumable sessions
-- Features: Session titles, quiz state persistence, recency sorting
-- ============================================================================

-- 1. ADD SESSION TITLE (auto-generated from first message)
-- This allows showing chat titles in a sidebar like ChatGPT
ALTER TABLE hai_chat_sessions 
ADD COLUMN IF NOT EXISTS title TEXT;

-- 2. ADD QUIZ STATE (for resuming quizzes later)
-- Stores current quiz progress if user abandons mid-quiz
-- Structure: {quiz_id, current_question, answers: [], score, started_at}
ALTER TABLE hai_chat_sessions 
ADD COLUMN IF NOT EXISTS quiz_state JSONB DEFAULT NULL;

-- 3. ADD last_message_at for sorting (most recent chats first)
ALTER TABLE hai_chat_sessions 
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW();

-- 4. TRIGGER to update last_message_at and auto-generate title
CREATE OR REPLACE FUNCTION hai_update_session_last_message()
RETURNS TRIGGER AS $$
BEGIN
    -- Update last_message_at timestamp
    UPDATE hai_chat_sessions
    SET last_message_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.session_id;
    
    -- Auto-generate title from first user message if not set
    IF (SELECT title FROM hai_chat_sessions WHERE id = NEW.session_id) IS NULL 
       AND NEW.role = 'user' THEN
        UPDATE hai_chat_sessions
        SET title = LEFT(NEW.content, 50) || CASE WHEN LENGTH(NEW.content) > 50 THEN '...' ELSE '' END
        WHERE id = NEW.session_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hai_messages_update_session ON hai_chat_messages;
CREATE TRIGGER hai_messages_update_session
    AFTER INSERT ON hai_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION hai_update_session_last_message();

-- 5. INDEX for sorting sessions by recency (most recent first)
CREATE INDEX IF NOT EXISTS idx_hai_sessions_last_message 
    ON hai_chat_sessions(user_id, last_message_at DESC);

-- ============================================================================
-- CLARIFICATIONS
-- ============================================================================
-- is_active = true:  Currently active session (auto-loaded when user opens chat)
-- is_active = false: Archived session (still visible in history, just not auto-loaded)
--
-- IMPORTANT: Archived sessions are NOT deleted! Users can:
-- - See all their old chats in a sidebar
-- - Click any chat to resume it
-- - Continue quizzes from where they left off (via quiz_state)
-- ============================================================================

-- Documentation
COMMENT ON COLUMN hai_chat_sessions.title IS 
    'Auto-generated from first user message, shown in chat sidebar like ChatGPT';
COMMENT ON COLUMN hai_chat_sessions.quiz_state IS 
    'Stores quiz progress for resuming later: {quiz_id, current_question, answers, score, started_at}';
COMMENT ON COLUMN hai_chat_sessions.last_message_at IS 
    'Timestamp of most recent message, used for sorting chats by recency';
COMMENT ON COLUMN hai_chat_sessions.is_active IS 
    'true = currently active, false = archived (still accessible in chat history)';
