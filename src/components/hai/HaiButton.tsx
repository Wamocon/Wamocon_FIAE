'use client';

/**
 * HAI Floating Button
 * 
 * Features real animated shark logo (WebP).
 */

import React from 'react';
import Image from 'next/image';
import { useHai } from './HaiProvider';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp } from 'lucide-react';

export function HaiButton() {
    const { viewMode, toggleChat, messages, setViewMode } = useHai();

    if (viewMode === 'full') return null;

    const isActive = viewMode !== 'hidden' && viewMode !== 'minimized';
    const hasMessages = messages.length > 0;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
            {/* Minimized Indicator */}
            <AnimatePresence>
                {viewMode === 'minimized' && hasMessages && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="bg-card border border-border/50 shadow-lg rounded-xl px-4 py-2 mb-2 flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => setViewMode('widget')}
                    >
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                        </span>
                        <span className="text-sm font-medium">Chat fortsetzen</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Button */}
            <motion.button
                onClick={toggleChat}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`
                    relative group
                    w-20 h-20 rounded-full
                    flex items-center justify-center
                    shadow-xl shadow-cyan-500/40
                    transition-all duration-300
                    overflow-hidden
                    ${isActive
                        ? 'bg-background/90 backdrop-blur-md border border-border'
                        : 'bg-[#020b1c] border-2 border-cyan-500/40' // Dark blue bg to match shark gif
                    }
                `}
                aria-label={isActive ? 'Schließen' : 'HAI öffnen'}
            >
                {/* Glow Ring */}
                {!isActive && (
                    <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{
                            background: 'radial-gradient(circle, rgba(34, 211, 238, 0.2) 0%, transparent 70%)',
                        }}
                        animate={{
                            scale: [1, 1.1, 1],
                            opacity: [0.5, 0.8, 0.5],
                        }}
                        transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                    />
                )}

                <AnimatePresence mode="wait">
                    {isActive ? (
                        <motion.div
                            key="close"
                            initial={{ rotate: -90, opacity: 0 }}
                            animate={{ rotate: 0, opacity: 1 }}
                            exit={{ rotate: 90, opacity: 0 }}
                        >
                            <ChevronUp className="w-6 h-6 text-foreground" />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="open"
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            className="relative w-full h-full"
                        >
                            <Image
                                src="/images/shark-new.gif"
                                alt="HAI"
                                fill
                                className="object-cover scale-110"
                                unoptimized
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Hover Tooltip */}
                {!isActive && (
                    <span className="
                        absolute right-full mr-4 top-1/2 -translate-y-1/2
                        px-3 py-1.5 rounded-lg
                        bg-popover text-popover-foreground text-sm font-medium
                        opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0
                        transition-all duration-200 pointer-events-none whitespace-nowrap
                        border border-border/50 shadow-md
                    ">
                        Frag HAI
                    </span>
                )}
            </motion.button>
        </div>
    );
}

export default HaiButton;
