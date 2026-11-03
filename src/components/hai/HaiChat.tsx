'use client';

/**
 * HAI Chat Interface
 *
 * Master component that handles the side panel (a column of the app layout at
 * the right edge that the person can pull wider or narrower, the HAI symbol is
 * its handle) and the Full-Screen mode.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useHai } from './HaiProvider';
import { HAI_HEADER_OFFSET_CLASS, HAI_PANEL_ID } from './haiLayout';
import { useOptionalHaiDock } from './HaiDockContext';
import { HaiDockHandle } from './HaiDockHandle';
import { useOptionalHaiVoiceSession } from './voice-mode/voiceSessionContext';
import { usePrefersReducedMotion } from './voice-mode/usePrefersReducedMotion';
import { useLanguage } from '@/contexts/LanguageContext';
import { HaiMessage } from './HaiMessage';
import { HaiSessionList } from './HaiSessionList';
import { HaiVoiceControl } from './HaiVoiceControl';
import { HaiVoiceModeButton } from './voice-mode/HaiVoiceModeButton';
import { HaiQuizModeButton, HaiQuizPanel } from './HaiQuizPanel';
import { useHaiQuizMode } from './HaiQuizMode';
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

  // No early return for 'hidden': the panel plays its closing animation first
  // (the column of the layout shrinks at the same time), AnimatePresence
  // removes it afterwards.
  return (
    <AnimatePresence mode="wait">
      {viewMode === 'widget' && <ChatPanel key="panel" />}
      {viewMode === 'full' && <ChatFull key="full" />}
    </AnimatePresence>
  );
}

// ============================================================================
// SIDE PANEL (a column of the layout at the right, the HAI symbol is its handle)
// ============================================================================

/** Moves the focus back to the HAI symbol (the handle of the panel). */
function focusHandle() {
  document
    .querySelector<HTMLElement>('[data-hai-handle]')
    ?.focus({ preventScroll: true });
}

/**
 * The text chat as a panel at the right edge of the page (the main navigation
 * is at the left, so they never meet).
 *
 * Docked (from 768 px up, while the page keeps 480 px, haiDock.ts): the panel is
 * rendered into the column of the app layout (HaiDockColumn, MainLayout) by a
 * portal, so it is a part of the layout: the header and the page get narrower
 * and move to the left, nothing lies under the panel. It has the chosen width
 * (--hai-panel-width, HaiDockHandle pulls it) and clings to the left edge of the
 * column, so it slides in with the edge of the page. The portal keeps it in the
 * chat provider: the history stays and the panel is not mounted again when the
 * HAI opens another page.
 *
 * Not docked (a phone, a narrow window, no layout around): a sheet over the
 * page that slides in from the right, the page behind does not move.
 *
 * The page behind stays usable and is not darkened in both cases, so there is no
 * focus trap and no modal. The focus goes to the input when it opens and back to
 * the HAI symbol when it closes (symbol, close button, Esc). With reduced motion
 * the panel appears and disappears without moving.
 */
function ChatPanel() {
  const { t } = useLanguage();
  const {
    setViewMode,
    messages,
    sendMessage,
    stopGeneration,
    isLoading,
    streamingMessageId,
  } = useHai();

  const quizActive = useHaiQuizMode().active;
  const reduced = usePrefersReducedMotion();
  const voiceSession = useOptionalHaiVoiceSession();
  const voiceOpen = !!voiceSession && voiceSession.view !== 'closed';
  const voiceOpenRef = useRef(false);
  voiceOpenRef.current = voiceOpen;

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const dock = useOptionalHaiDock();
  const slot = dock?.docked ? dock.slotEl : null;

  // the focus jumps into the input when the panel opens
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // The pond of the voice mode sits left of the panel (the symbol rides on its
  // edge). Below lg there is no room for the pond and its speech bubble next to
  // the panel, so the panel gives way (the chat shows everything afterwards).
  useEffect(() => {
    if (!voiceOpen) return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      setViewMode('hidden');
    }
  }, [voiceOpen, setViewMode]);

  const closePanel = () => {
    setViewMode('hidden');
    focusHandle();
  };

  // Esc closes the panel (not while the voice mode is open: Esc ends that first,
  // and not when the focus is somewhere else on the page, e.g. in a dialog)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (voiceOpenRef.current) return;
      const active = document.activeElement;
      const inside =
        !active ||
        active === document.body ||
        !!panelRef.current?.contains(active) ||
        active.hasAttribute('data-hai-handle');
      if (!inside) return;
      event.preventDefault();
      setViewMode('hidden');
      focusHandle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setViewMode]);

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

  const panel = (
    <motion.aside
      ref={panelRef}
      id={HAI_PANEL_ID}
      aria-label={t('hai.panel.label')}
      data-testid="hai-chat-panel"
      data-side="right"
      data-docked={slot ? 'true' : 'false'}
      // Docked: the column moves, the panel only fades (the edge of the page
      // carries it in). Sheet: slides in from the right.
      initial={slot ? { opacity: 0 } : { x: '100%' }}
      animate={slot ? { opacity: 1 } : { x: 0 }}
      exit={slot ? { opacity: 0 } : { x: '100%' }}
      transition={{
        duration: reduced ? 0 : 0.28,
        ease: [0.32, 0.72, 0, 1],
      }}
      // Docked: full height of the column (beside the header, which is narrower
      // now), at the left edge of the column. Sheet: right edge, under the page
      // header (top-16); the navigation is at the left; on a phone full width
      // that leaves a strip below for the symbol. z-40 like the symbol, under
      // viewers and dialogs (z-50). No backdrop.
      className={
        slot
          ? '@container absolute inset-y-0 left-0 flex w-[var(--hai-panel-width,420px)] flex-col border-l border-cyan-500/30 bg-[#0f1117] text-gray-100'
          : `@container ${HAI_HEADER_OFFSET_CLASS} fixed right-0 bottom-24 z-40 flex w-full flex-col rounded-b-2xl border-l border-cyan-500/30 bg-[#0f1117] text-gray-100 shadow-2xl shadow-cyan-950/50 md:bottom-0 md:w-[420px] md:rounded-none`
      }
    >
      {slot && <HaiDockHandle />}
      {/* Header (h-16 like the page header, so the two lines meet) */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#161b22] px-4">
        <div className="flex items-center gap-3">
          <HaiLogoInline />
          {/* the header follows the width of the panel (the person pulls it, a
              container query): the badge goes first, then the labels */}
          <span className="hidden rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-black @[28rem]:inline-block">
            BETA
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <HaiVoiceModeButton className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-cyan-400 transition-colors hover:bg-cyan-500/20 @max-[24rem]:[&>span]:hidden" />
          <HaiQuizModeButton className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-cyan-400 transition-colors hover:bg-cyan-500/20 @max-[24rem]:[&>span]:hidden" />
          <button
            onClick={() => setViewMode('full')}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('hai.actions.maximize')}
            title={t('hai.actions.maximize')}
          >
            <Maximize2 className="h-5 w-5" />
          </button>
          <button
            onClick={closePanel}
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
        className={`min-h-0 flex-1 space-y-4 bg-[#0f1117] p-4 ${messages.length === 0 && !quizActive ? 'overflow-visible' : 'overflow-y-auto'}`}
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
        <HaiQuizPanel />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="rounded-b-2xl border-t border-white/10 bg-[#161b22] p-3 md:rounded-none">
        <HaiVoiceControl />
        <div className="relative">
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
    </motion.aside>
  );

  return slot ? createPortal(panel, slot) : panel;
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
              <HaiVoiceModeButton className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20" />
              <HaiQuizModeButton />
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
              <HaiQuizPanel />
            </div>
          </div>

          {/* Input Area */}
          <div className="bg-black/20 p-4 md:p-6">
            <div className="relative mx-auto max-w-3xl">
              <HaiVoiceControl />
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
