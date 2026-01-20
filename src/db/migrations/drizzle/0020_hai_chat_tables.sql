-- ============================================================================
-- HAI.ai Migration 3: Create Chat Tables
-- ============================================================================
-- Description: Creates tables for storing chat sessions and messages
-- Features: Session management, message history, conversation context
-- ============================================================================

-- Chat Sessions Table
-- Stores conversation sessions for context continuity
CREATE TABLE IF NOT EXISTS hai_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User reference (must exist in profiles table)
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Context (what the user is currently viewing)
    context_type TEXT CHECK (context_type IN ('enabler', 'course', 'quiz', 'general')),
    context_id UUID,
    
    -- Session state
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user session lookups (find active sessions for a user)
CREATE INDEX IF NOT EXISTS idx_hai_sessions_user 
    ON hai_chat_sessions(user_id, is_active);

-- Index for context-based lookups (find sessions about a specific enabler)
CREATE INDEX IF NOT EXISTS idx_hai_sessions_context 
    ON hai_chat_sessions(context_type, context_id);

COMMENT ON TABLE hai_chat_sessions IS 'HAI.ai chat sessions for conversation context';

-- Chat Messages Table
-- Stores individual messages within sessions
CREATE TABLE IF NOT EXISTS hai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Session reference
    session_id UUID NOT NULL REFERENCES hai_chat_sessions(id) ON DELETE CASCADE,
    
    -- Message content
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    
    -- Additional data (citations, quiz data, etc.)
    citations JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    
    -- Usage tracking
    tokens_used INTEGER,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for message retrieval by session (chronological order)
CREATE INDEX IF NOT EXISTS idx_hai_messages_session 
    ON hai_chat_messages(session_id, created_at);

COMMENT ON TABLE hai_chat_messages IS 'HAI.ai individual chat messages';
