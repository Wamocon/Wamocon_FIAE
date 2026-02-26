'use client';

/**
 * HAI Message Component
 *
 * Renders individual chat messages with modern styling.
 * User: Bubble, Right aligned.
 * HAI: Avatar + Text, Left aligned.
 * Supports streaming state with thinking animation and typing cursor.
 */

import React from 'react';
import { HaiMessage as MessageType, useHai } from './HaiProvider';
import { useLanguage } from '@/contexts/LanguageContext';
import { MarkdownText } from '@/components/ui/MarkdownText';
import { motion } from 'framer-motion';
import {
  User,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface HaiMessageProps {
  message: MessageType;
  isStreaming?: boolean;
}

export function HaiMessage({ message, isStreaming = false }: HaiMessageProps) {
  const { t } = useLanguage();
  const { updateMessage, regenerateFromEdit, setActiveVersion } = useHai();
  const isUser = message.role === 'user';
  const hasCitations = message.citations && message.citations.length > 0;
  const isThinking = isStreaming && !message.content;
  const hasVersions = !!message.versions && message.versions.length > 1;
  const activeIndex = message.activeVersionIndex ?? 0;

  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.content);

  React.useEffect(() => {
    if (!isEditing) {
      setEditValue(message.content);
    }
  }, [message.content, isEditing]);

  const handleSave = React.useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (trimmed === message.content.trim()) {
      setIsEditing(false);
      return;
    }
    // Close the editor immediately
    setIsEditing(false);
    // regenerateFromEdit sends POST with editMessageId which handles:
    // 1. Updating user message content + version history in DB
    // 2. Updating assistant message in-place (no duplicate)
    // 3. Streaming the new answer
    regenerateFromEdit(message.id, trimmed);
  }, [editValue, message.content, message.id, regenerateFromEdit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 shadow-sm ${isUser ? 'bg-[#1f2937]' : 'bg-cyan-500/10'} `}
      >
        {isUser ? (
          <User className="h-4 w-4 text-gray-400" />
        ) : (
          <span className="text-sm">🦈</span>
        )}
      </div>

      {/* Content */}
      <div
        className={`flex max-w-[85%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} `}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser
            ? 'rounded-tr-sm bg-[#1f2937] text-gray-100'
            : 'bg-transparent pt-1 pl-0 text-gray-200 shadow-none'
            } `}
        >
          {isThinking ? (
            <ThinkingAnimation />
          ) : (
            <>
              {isUser && isEditing ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500/50 focus:outline-none"
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditValue(message.content);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                      {t('hai.actions.cancel')}
                    </button>
                    <button
                      onClick={handleSave}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-xs text-white transition-colors hover:bg-cyan-500"
                    >
                      <Check className="h-3 w-3" />
                      {t('hai.actions.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <MarkdownText className="prose-code:text-gray-100 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded prose-strong:text-white prose-strong:font-bold prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline prose-ul:list-disc prose-ul:pl-6 prose-ul:my-4 prose-ol:list-decimal prose-ol:pl-6 prose-ol:my-4 prose-li:text-gray-200 prose-li:my-2 prose-li:leading-relaxed prose-li:marker:text-cyan-500 prose-p:text-gray-200 prose-p:leading-relaxed prose-p:mb-4 prose-headings:text-white prose-headings:font-bold prose-headings:mb-4 prose-headings:mt-6 prose-hr:border-white/10 prose-hr:my-6 max-w-none">
                  {message.content}
                </MarkdownText>
              )}
              {isStreaming && <StreamingCursor />}
            </>
          )}
        </div>

        {/* Edit button & version navigation for user messages */}
        {isUser && !isStreaming && !isEditing && (
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
              title={t('hai.actions.edit')}
            >
              <Pencil className="h-3 w-3" />
              {t('hai.actions.edit')}
            </button>
            {hasVersions && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <button
                  onClick={() => setActiveVersion(message.id, activeIndex - 1)}
                  disabled={activeIndex <= 0}
                  className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0.5 transition-colors hover:bg-white/10 disabled:opacity-40"
                  title={t('hai.message.previousQuestion')}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="min-w-9 text-center">
                  {activeIndex + 1}/{message.versions?.length}
                </span>
                <button
                  onClick={() => setActiveVersion(message.id, activeIndex + 1)}
                  disabled={activeIndex >= (message.versions?.length || 1) - 1}
                  className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0.5 transition-colors hover:bg-white/10 disabled:opacity-40"
                  title={t('hai.message.nextQuestion')}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Version navigation for assistant messages — hidden, controlled by user message slider */}
        {false && !isUser && hasVersions && (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
            <button
              onClick={() => setActiveVersion(message.id, activeIndex - 1)}
              disabled={activeIndex <= 0}
              className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0.5 transition-colors hover:bg-white/10 disabled:opacity-40"
              title={t('hai.message.previousAnswer')}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span className="min-w-9 text-center">
              {activeIndex + 1}/{message.versions?.length}
            </span>
            <button
              onClick={() => setActiveVersion(message.id, activeIndex + 1)}
              disabled={activeIndex >= (message.versions?.length || 1) - 1}
              className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0.5 transition-colors hover:bg-white/10 disabled:opacity-40"
              title={t('hai.message.nextAnswer')}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Assistant Citations */}
        {!isUser && hasCitations && (
          <div className="mt-1 ml-0 flex flex-wrap gap-2">
            {message.citations?.map((citation, idx) =>
              citation.url ? (
                <a
                  key={idx}
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-400 transition-colors hover:bg-cyan-500/20 hover:text-cyan-300"
                  title={t('hai.message.openPdf')}
                >
                  📚 {citation.title} ↗
                </a>
              ) : (
                <div
                  key={idx}
                  className="cursor-help rounded-md border border-cyan-500/10 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-600/80 transition-colors hover:bg-cyan-500/10"
                  title={t('hai.message.kbSource')}
                >
                  📚 {citation.title}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// STREAMING COMPONENTS
// ============================================================================

/**
 * Animated "thinking" indicator shown while waiting for the first token.
 * Shows a playful orbiting bubble and a bobbing shark.
 */
function ThinkingAnimation() {
  const { t } = useLanguage();
  const phrases = [
    t('hai.loading.thinking1') || 'Thinking',
    t('hai.loading.thinking2') || 'Sorting knowledge',
    t('hai.loading.thinking3') || 'Formulating answer',
  ];
  const [phraseIndex, setPhraseIndex] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex(prev => (prev + 1) % phrases.length);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="relative h-6 w-6">
        <motion.div
          className="absolute inset-0 rounded-full border border-cyan-400/40"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400"
          animate={{
            x: [0, 8, 0, -8, 0],
            y: [-8, 0, 8, 0, -8],
            opacity: [0.6, 1, 0.6, 1, 0.6],
          }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300"
          animate={{
            x: [0, -8, 0, 8, 0],
            y: [8, 0, -8, 0, 8],
            opacity: [0.4, 0.9, 0.4, 0.9, 0.4],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -top-1 -right-1 text-xs"
          animate={{ y: [0, -2, 0], rotate: [0, -6, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          🦈
        </motion.div>
      </div>
      <motion.span
        key={phraseIndex}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        className="text-sm font-medium text-gray-400"
      >
        {phrases[phraseIndex]}
      </motion.span>
    </div>
  );
}

/**
 * Blinking cursor shown at the end of streaming text.
 */
function StreamingCursor() {
  return (
    <motion.span
      className="ml-0.5 inline-block h-[1em] w-0.5 bg-cyan-400 align-text-bottom"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity }}
    />
  );
}

export default HaiMessage;
