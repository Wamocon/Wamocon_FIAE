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
    Maximize2, Minimize2, X, Send, Sparkles,
    PanelLeftClose, PanelLeftOpen
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
        messages, sendMessage, isLoading, context
    } = useHai();

    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
            className="
        fixed bottom-24 right-6 z-50
        w-[400px] h-[600px] max-h-[80vh] max-w-[calc(100vw-48px)]
        bg-[#0f1117] text-gray-100
        border border-cyan-500/30 shadow-2xl shadow-cyan-950/50
        rounded-2xl flex flex-col shadow-2xl shadow-cyan-950/50
      "
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#161b22] rounded-t-2xl">
                <div className="flex items-center gap-3">
                    <HaiLogoInline />
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500 text-black">BETA</span>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setViewMode('full')}
                        className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                        title={t('hai.actions.maximize')}
                    >
                        <Maximize2 className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setViewMode('hidden')}
                        className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                        title={t('common.close')}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className={`flex-1 p-4 space-y-4 bg-[#0f1117] ${messages.length === 0 ? 'overflow-visible' : 'overflow-y-auto'}`}>
                {messages.length === 0 ? (
                    <EmptyState />
                ) : (
                    messages.map((msg, i) => (
                        <HaiMessage key={msg.id || i} message={msg} />
                    ))
                )}
                {isLoading && <LoadingIndicator />}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 bg-[#161b22] border-t border-white/10 rounded-b-2xl">
                <div className="relative">
                    <textarea
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder={t('hai.askPlaceholder')}
                        className="
              w-full bg-[#0d1117] hover:bg-black focus:bg-black
              border border-white/10 focus:border-cyan-500/50
              rounded-xl pl-4 pr-12 py-3
              text-sm text-gray-100 placeholder:text-gray-500
              resize-none
              resize-none
              focus:outline-none focus:ring-1 focus:ring-cyan-500/50
              transition-all
            "
                        rows={1}
                        style={{ minHeight: '46px', maxHeight: '120px' }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim() || isLoading}
                        className="
              absolute right-1.5 top-1.5 bottom-1.5
              aspect-square rounded-lg
              bg-cyan-600 hover:bg-cyan-500
              disabled:opacity-50 disabled:bg-transparent disabled:text-gray-600
              text-white flex items-center justify-center
              transition-all shadow-lg shadow-cyan-900/20
            "
                    >
                        <Send className="w-4 h-4" />
                    </button>
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
        setViewMode, newSession,
        messages, sendMessage, isLoading, context
    } = useHai();

    const [inputValue, setInputValue] = useState('');
    const [showSidebar, setShowSidebar] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        inputRef.current?.focus();
    }, [messages]);

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
            <div className="
        relative w-full max-w-[1600px] h-full
        bg-[#0f1117]/98 backdrop-blur-xl
        border border-white/10 shadow-2xl shadow-cyan-900/20
        rounded-2xl overflow-hidden
        flex flex-col md:flex-row text-gray-100
      ">
                {/* Sidebar (History) */}
                <AnimatePresence>
                    {showSidebar && (
                        <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 280, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            className="border-r border-white/10 bg-[#050505]/50 hidden md:flex flex-col"
                        >
                            <div className="h-20 flex items-center justify-between px-6 border-b border-white/10">
                                <span className="text-lg font-bold text-white tracking-wider uppercase">{t('hai.history.title')}</span>
                                <button onClick={() => setShowSidebar(false)} className="text-muted-foreground hover:text-foreground p-1 hover:bg-white/5 rounded-md transition-colors">
                                    <PanelLeftClose className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <HaiSessionList className="h-full" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Main Content */}
                <div className="flex-1 flex flex-col relative bg-gradient-to-tr from-cyan-500/5 via-transparent to-blue-500/5">

                    {/* Top Bar */}
                    <div className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-8">
                        <div className="flex items-center gap-3">
                            {!showSidebar && (
                                <button
                                    onClick={() => setShowSidebar(true)}
                                    className="p-2 hover:bg-white/5 rounded-lg text-muted-foreground hidden md:block"
                                >
                                    <PanelLeftOpen className="w-5 h-5" />
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
                                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 text-sm font-medium transition-colors"
                            >
                                <Sparkles className="w-4 h-4" />
                                <span>{t('hai.newChat')}</span>
                            </button>

                            <div className="w-px h-6 bg-white/10 mx-2" />

                            <button onClick={() => setViewMode('widget')} className="p-2 hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground" title={t('hai.actions.minimize')}>
                                <Minimize2 className="w-5 h-5" />
                            </button>
                            <button onClick={() => setViewMode('hidden')} className="p-2 hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground" title={t('common.close')}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
                            {messages.length === 0 ? (
                                <div className="h-[50vh] flex flex-col items-center justify-center text-center">
                                    <HaiLogoBanner size="xl" showText={false} className="mb-6" />
                                    <h1 className="text-5xl font-bold text-white mb-6 shadow-xl">
                                        {t('hai.welcome.greeting')}
                                    </h1>
                                    <p className="text-gray-200 max-w-lg mb-10 text-xl font-medium leading-relaxed">
                                        {t('hai.welcome.description')}
                                    </p>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                                        <SuggestionCard icon="🧠" title={t('hai.suggestions.quiz')} desc={t('hai.suggestions.quizDesc')} onClick={() => setInputValue('/quiz ')} />
                                        <SuggestionCard icon="📝" title={t('hai.suggestions.summarize')} desc={t('hai.suggestions.summarizeDesc')} onClick={() => setInputValue(t('hai.suggestions.summarizePrompt'))} />
                                        <SuggestionCard icon="💻" title={t('hai.suggestions.explainCode')} desc={t('hai.suggestions.explainCodeDesc')} onClick={() => setInputValue(t('hai.suggestions.explainCodePrompt'))} />
                                        <SuggestionCard icon="🎓" title={t('hai.suggestions.examTips')} desc={t('hai.suggestions.examTipsDesc')} onClick={() => setInputValue(t('hai.suggestions.examTipsPrompt'))} />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {messages.map((msg, i) => (
                                        <HaiMessage key={msg.id || i} message={msg} />
                                    ))}
                                    {isLoading && <LoadingIndicator />}
                                    <div ref={messagesEndRef} />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Input Area */}
                    <div className="p-4 md:p-6 bg-black/20">
                        <div className="max-w-3xl mx-auto relative">
                            <div className="
                relative rounded-2xl
                bg-[#161b22]/50 border border-white/5
                focus-within:border-cyan-500/30 focus-within:ring-1 focus-within:ring-cyan-500/30
                focus-within:bg-black/40
                transition-all duration-200
                shadow-lg
              ">
                                <textarea
                                    ref={inputRef}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder={t('hai.askPlaceholder')}
                                    className="
                     w-full bg-transparent border-none
                     text-xl text-white px-6 py-5 pr-14
                     resize-none focus:ring-0
                     placeholder:text-gray-400 font-medium
                  "
                                    rows={1}
                                    style={{ minHeight: '60px', maxHeight: '200px' }}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim() || isLoading}
                                    className="
                    absolute right-3 bottom-3
                    p-2 rounded-xl
                    bg-cyan-500 hover:bg-cyan-600
                    disabled:opacity-0 disabled:pointer-events-none
                    text-white transition-all
                  "
                                >
                                    <Send className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-center text-xs text-gray-500 mt-3">
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
        <div className="flex flex-col items-center justify-center h-[300px] text-center opacity-80">
            <HaiLogoBanner size="xl" showText={false} hideSpeechBubble={true} className="mb-4" />
            <p className="text-base font-medium text-gray-300">
                {t('hai.ready')}
            </p>
            <p className="text-xs text-gray-500 mt-1">
                {t('hai.askToStart')}
            </p>
        </div>
    );
}

function LoadingIndicator() {
    return (
        <div className="flex gap-4 p-4 animate-in fade-in duration-300">
            <motion.div
                className="w-8 h-8 rounded-full overflow-hidden"
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
            <div className="flex items-center gap-1 h-8">
                <span className="w-2 h-2 bg-cyan-500/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-cyan-500/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-cyan-500/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
        </div>
    );
}

function SuggestionCard({ icon, title, desc, onClick }: { icon: string, title: string, desc: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="
        text-left p-4 rounded-xl
        bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cyan-500/30
        transition-all duration-200 group
      "
        >
            <div className="font-semibold text-white text-lg mb-1 group-hover:text-cyan-400 transition-colors flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <span>{title}</span>
            </div>
            <div className="text-sm text-gray-300 font-normal opacity-90">
                {desc}
            </div>
        </button>
    );
}

export default HaiChat;
