'use client';

/**
 * HAI Chat Interface
 *
 * Master component that handles both Widget and Full-Screen modes.
 * Implements modern "Glass & Gradient" aesthetic.
 */

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useHai } from './HaiProvider';
import { useLanguage } from '@/contexts/LanguageContext';
import { HaiMessage } from './HaiMessage';
import { HaiSessionList } from './HaiSessionList';
import { HaiLogoBanner, HaiLogoInline } from './HaiLogoBanner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Maximize2,
  Minimize2,
  X,
  Send,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
} from 'lucide-react';

export function HaiChat() {
  const { viewMode } = useHai();

  if (viewMode === 'hidden') return null;

  return (
    <AnimatePresence mode="wait">
      {viewMode === 'widget' && <ChatWidget key="widget" />}
      {viewMode === 'full' && <ChatFull key="full" />}
    </AnimatePresence>
  );
}

// ============================================================================
// WIDGET VIEW (Floating Popover)
// ============================================================================

function ChatWidget() {
  const { t } = useLanguage();
  const {
    setViewMode,
    messages,
    sendMessage,
    stopGeneration,
    isLoading,
    streamingMessageId,
    context,
  } = useHai();

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Only auto-scroll when new messages are added (not on edits in the middle)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Keep streaming content in view when the streaming message is at the bottom
  useEffect(() => {
    if (!streamingMessageId || messages.length === 0) return;
    if (messages[messages.length - 1]?.id === streamingMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingMessageId, messages]);

  const handleSend = () => {
    if (!inputValue.trim() || isLoading) return;
    sendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="fixed right-6 bottom-24 z-50 flex h-[600px] max-h-[80vh] w-[400px] max-w-[calc(100vw-48px)] flex-col rounded-2xl border border-cyan-500/30 bg-[#0f1117] text-gray-100 shadow-2xl shadow-cyan-950/50"
    >
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl border-b border-white/10 bg-[#161b22] px-4 py-3">
        <div className="flex items-center gap-3">
          <HaiLogoInline />
          <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-black">
            BETA
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('full')}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('hai.actions.maximize')}
            title={t('hai.actions.maximize')}
          >
            <Maximize2 className="h-5 w-5" />
          </button>
          <button
            onClick={() => setViewMode('hidden')}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className={`flex-1 space-y-4 bg-[#0f1117] p-4 ${messages.length === 0 ? 'overflow-visible' : 'overflow-y-auto'}`}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((msg, i) => (
            <HaiMessage
              key={msg.id || i}
              message={msg}
              isStreaming={
                isLoading &&
                msg.role === 'assistant' &&
                msg.id === streamingMessageId
              }
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="rounded-b-2xl border-t border-white/10 bg-[#161b22] p-3">
        <div className="relative">
          <textarea
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('hai.askPlaceholder')}
            className="w-full resize-none rounded-xl border border-white/10 bg-[#0d1117] py-3 pr-12 pl-4 text-sm text-gray-100 transition-all placeholder:text-gray-500 hover:bg-black focus:border-cyan-500/50 focus:bg-black focus:ring-1 focus:ring-cyan-500/50 focus:outline-none"
            rows={1}
            style={{ minHeight: '46px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            aria-label={t('hai.actions.send')}
            className="absolute top-1.5 right-1.5 bottom-1.5 flex aspect-square items-center justify-center rounded-lg bg-cyan-600 text-white shadow-lg shadow-cyan-900/20 transition-all hover:bg-cyan-500 disabled:bg-transparent disabled:text-gray-600 disabled:opacity-50"
            style={{ display: isLoading ? 'none' : 'flex' }}
          >
            <Send className="h-4 w-4" />
          </button>
          {isLoading && (
            <button
              onClick={stopGeneration}
              className="absolute top-1.5 right-1.5 bottom-1.5 flex aspect-square items-center justify-center rounded-lg bg-red-500/80 text-white shadow-lg shadow-red-900/20 transition-all hover:bg-red-500"
              aria-label={t('hai.actions.stop')}
              title={t('hai.actions.stop')}
            >
              <Square className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// FULL SCREEN VIEW
// ============================================================================

function ChatFull() {
  const { t } = useLanguage();
  const {
    setViewMode,
    newSession,
    messages,
    sendMessage,
    stopGeneration,
    isLoading,
    streamingMessageId,
    context,
  } = useHai();

  const [inputValue, setInputValue] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Only auto-scroll when new messages are added (not on edits in the middle)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    inputRef.current?.focus();
  }, [messages.length]);

  // Keep streaming content in view when the streaming message is at the bottom
  useEffect(() => {
    if (!streamingMessageId || messages.length === 0) return;
    if (messages[messages.length - 1]?.id === streamingMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingMessageId, messages]);

  const handleSend = () => {
    if (!inputValue.trim() || isLoading) return;
    sendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={() => setViewMode('widget')}
      />

      {/* Main Container */}
      <div className="relative flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1117]/98 text-gray-100 shadow-2xl shadow-cyan-900/20 backdrop-blur-xl md:flex-row">
        {/* Sidebar (History) */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="hidden flex-col border-r border-white/10 bg-[#050505]/50 md:flex"
            >
              <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
                <span className="text-lg font-bold tracking-wider text-white uppercase">
                  {t('hai.history.title')}
                </span>
                <button
                  onClick={() => setShowSidebar(false)}
                  aria-label={t('hai.actions.hideSidebar')}
                  className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors hover:bg-white/5"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <HaiSessionList className="h-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="relative flex flex-1 flex-col bg-gradient-to-tr from-cyan-500/5 via-transparent to-blue-500/5">
          {/* Top Bar */}
          <div className="flex h-20 items-center justify-between border-b border-white/5 px-6 md:px-8">
            <div className="flex items-center gap-3">
              {!showSidebar && (
                <button
                  onClick={() => setShowSidebar(true)}
                  aria-label={t('hai.actions.showSidebar')}
                  className="text-muted-foreground hidden rounded-lg p-2 hover:bg-white/5 md:block"
                >
                  <PanelLeftOpen className="h-5 w-5" />
                </button>
              )}

              <div className="flex items-center gap-4">
                <HaiLogoInline />
                <span className="text-xl font-light text-gray-500">/</span>
                <span className="text-xl font-medium text-gray-200">
                  {context.enablerTitle || t('hai.newChat')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={newSession}
                className="hidden items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20 md:flex"
              >
                <Sparkles className="h-4 w-4" />
                <span>{t('hai.newChat')}</span>
              </button>

              <div className="mx-2 h-6 w-px bg-white/10" />

              <button
                onClick={() => setViewMode('widget')}
                className="text-muted-foreground hover:text-foreground rounded-lg p-2 hover:bg-white/5"
                aria-label={t('hai.actions.minimize')}
                title={t('hai.actions.minimize')}
              >
                <Minimize2 className="h-5 w-5" />
              </button>
              <button
                onClick={() => setViewMode('hidden')}
                className="text-muted-foreground hover:text-foreground rounded-lg p-2 hover:bg-white/5"
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
              {messages.length === 0 ? (
                <div className="flex h-[50vh] flex-col items-center justify-center text-center">
                  <HaiLogoBanner size="xl" showText={false} className="mb-6" />
                  <h1 className="mb-6 text-5xl font-bold text-white shadow-xl">
                    {t('hai.welcome.greeting')}
                  </h1>
                  <p className="mb-10 max-w-lg text-xl leading-relaxed font-medium text-gray-200">
                    {t('hai.welcome.description')}
                  </p>

                  <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
                    <SuggestionCard
                      icon="🧠"
                      title={t('hai.suggestions.quiz')}
                      desc={t('hai.suggestions.quizDesc')}
                      onClick={() => setInputValue('/quiz ')}
                    />
                    <SuggestionCard
                      icon="📝"
                      title={t('hai.suggestions.summarize')}
                      desc={t('hai.suggestions.summarizeDesc')}
                      onClick={() =>
                        setInputValue(t('hai.suggestions.summarizePrompt'))
                      }
                    />
                    <SuggestionCard
                      icon="💻"
                      title={t('hai.suggestions.explainCode')}
                      desc={t('hai.suggestions.explainCodeDesc')}
                      onClick={() =>
                        setInputValue(t('hai.suggestions.explainCodePrompt'))
                      }
                    />
                    <SuggestionCard
                      icon="🎓"
                      title={t('hai.suggestions.examTips')}
                      desc={t('hai.suggestions.examTipsDesc')}
                      onClick={() =>
                        setInputValue(t('hai.suggestions.examTipsPrompt'))
                      }
                    />
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    <HaiMessage
                      key={msg.id || i}
                      message={msg}
                      isStreaming={
                        isLoading &&
                        msg.role === 'assistant' &&
                        msg.id === streamingMessageId
                      }
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          </div>

          {/* Input Area */}
          <div className="bg-black/20 p-4 md:p-6">
            <div className="relative mx-auto max-w-3xl">
              <div className="relative rounded-2xl border border-white/5 bg-[#161b22]/50 shadow-lg transition-all duration-200 focus-within:border-cyan-500/30 focus-within:bg-black/40 focus-within:ring-1 focus-within:ring-cyan-500/30">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={t('hai.askPlaceholder')}
                  className="w-full resize-none border-none bg-transparent px-6 py-5 pr-14 text-xl font-medium text-white placeholder:text-gray-400 focus:ring-0"
                  rows={1}
                  style={{ minHeight: '60px', maxHeight: '200px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isLoading}
                  aria-label={t('hai.actions.send')}
                  className="absolute right-3 bottom-3 rounded-xl bg-cyan-500 p-2 text-white transition-all hover:bg-cyan-600 disabled:pointer-events-none disabled:opacity-0"
                  style={{ display: isLoading ? 'none' : 'block' }}
                >
                  <Send className="h-5 w-5" />
                </button>
                {isLoading && (
                  <button
                    onClick={stopGeneration}
                    className="absolute right-3 bottom-3 rounded-xl bg-red-500/80 p-2 text-white transition-all hover:bg-red-500"
                    aria-label={t('hai.actions.stop')}
                    title={t('hai.actions.stop')}
                  >
                    <Square className="h-5 w-5" />
                  </button>
                )}
              </div>
              <p className="mt-3 text-center text-xs text-gray-500">
                {t('hai.disclaimer')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="flex h-[300px] flex-col items-center justify-center text-center opacity-80">
      <HaiLogoBanner
        size="xl"
        showText={false}
        hideSpeechBubble={true}
        className="mb-4"
      />
      <p className="text-base font-medium text-gray-300">{t('hai.ready')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('hai.askToStart')}</p>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="animate-in fade-in flex gap-4 p-4 duration-300">
      <motion.div
        className="h-8 w-8 overflow-hidden rounded-full"
        animate={{ rotate: [0, 5, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Image
          src="/images/hai-logo.png"
          alt="HAI"
          width={32}
          height={32}
          className="drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]"
        />
      </motion.div>
      <div className="flex h-8 items-center gap-1">
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-cyan-500/50"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-cyan-500/50"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-cyan-500/50"
          style={{ animationDelay: '300ms' }}
        />
      </div>
    </div>
  );
}

function SuggestionCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-white/5 bg-white/5 p-4 text-left transition-all duration-200 hover:border-cyan-500/30 hover:bg-white/10"
    >
      <div className="mb-1 flex items-center gap-3 text-lg font-semibold text-white transition-colors group-hover:text-cyan-400">
        <span className="text-2xl">{icon}</span>
        <span>{title}</span>
      </div>
      <div className="text-sm font-normal text-gray-300 opacity-90">{desc}</div>
    </button>
  );
}

export default HaiChat;
