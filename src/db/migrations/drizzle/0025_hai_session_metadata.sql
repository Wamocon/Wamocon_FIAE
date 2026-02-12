-- Phase 2: Add metadata JSONB column to hai_chat_sessions
-- Stores conversation summary cache and other session-level metadata
-- { conversationSummary: string, summarizedUpTo: number }

ALTER TABLE hai_chat_sessions
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
