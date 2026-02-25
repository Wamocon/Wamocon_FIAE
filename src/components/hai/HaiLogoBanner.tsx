'use client';

/**
 * HAI Animated Logo Banner
 * 
 * Uses a real animated GIF/WebP for the shark animation.
 * Features a circular mask and glow effects for a professional look.
 * Includes a dynamic speech bubble interaction.
 */

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

interface HaiLogoBannerProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    showText?: boolean;
    className?: string;
    hideSpeechBubble?: boolean;
}

const sizeMap = {
    sm: { container: 60, text: 'text-lg', bubble: 'text-xs' },
    md: { container: 120, text: 'text-2xl', bubble: 'text-sm' },
    lg: { container: 180, text: 'text-4xl', bubble: 'text-base' },
    xl: { container: 240, text: 'text-5xl', bubble: 'text-lg' },
};

export function HaiLogoBanner({
    size = 'md',
    showText = true,
    className = '',
    hideSpeechBubble = false,
}: HaiLogoBannerProps) {
    const { t } = useLanguage();
    const { container: containerSize, text: textClass, bubble: bubbleClass } = sizeMap[size];
    const [showBubble, setShowBubble] = useState(false);

    useEffect(() => {
        if (hideSpeechBubble) return;

        // Show speech bubble after 1.5 seconds (simulating shark popping up)
        const timer = setTimeout(() => {
            setShowBubble(true);
        }, 1500);

        return () => clearTimeout(timer);
    }, [hideSpeechBubble]);

    return (
        <div className={`flex flex-col items-center gap-4 ${className}`}>
            <div className="relative">
                {/* Logo Container */}
                <motion.div
                    className="relative rounded-full overflow-hidden border-2 border-cyan-500/30 bg-[#020b1c]"
                    style={{ width: containerSize, height: containerSize }}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    {/* Glow Behind */}
                    <div className="absolute inset-0 bg-cyan-500/20 blur-xl" />

                    {/* Animated Shark Image (GIF) */}
                    <Image
                        src="/images/shark-new.gif"
                        alt={t('hai.logo.alt')}
                        fill
                        className="object-cover opacity-90 hover:opacity-100 transition-opacity duration-300 scale-110"
                        priority
                        unoptimized // Required for animated GIF
                    />
                </motion.div>

                {/* Overlay Gradient for depth */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#020b1c]/40 to-transparent pointer-events-none" />
            </div>

            {/* Speech Bubble */}
            <AnimatePresence>
                {showBubble && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5, x: -20, y: 10 }}
                        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }} // Pop effect
                        className={`absolute -top-4 -right-24 bg-white/10 light:bg-slate-800 backdrop-blur-md border border-cyan-500/30 text-white px-4 py-2 rounded-xl rounded-bl-none shadow-lg z-20 ${bubbleClass}`}
                        style={{ minWidth: '180px' }}
                    >
                        <div className="relative">
                            {/* Pointer Arrow */}
                            <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-white/10 border-b border-l border-cyan-500/30 transform -rotate-45" style={{ backdropFilter: 'blur(12px)' }}></div>
                            {t('hai.welcome.greeting')}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Text */}
            {showText && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="text-center"
                >
                    <h1 className={`font-bold text-foreground ${textClass} tracking-tight`}>
                        <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                            HAI
                        </span>
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1 font-medium">
                        {t('hai.tagline')}
                    </p>
                </motion.div>
            )}
        </div>
    );
}

/**
 * Inline logo for headers - animated
 */
export function HaiLogoInline({ className = '' }: { className?: string }) {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <motion.div
                className="relative rounded-full overflow-hidden border border-cyan-500/30 bg-[#020b1c]"
                style={{ width: 40, height: 40 }}
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
            >
                <Image
                    src="/images/shark-new.gif"
                    alt="HAI"
                    fill
                    className="object-cover scale-125"
                    unoptimized
                />
            </motion.div>
            <span className="font-bold text-xl bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                HAI
            </span>
        </div>
    );
}

export default HaiLogoBanner;
