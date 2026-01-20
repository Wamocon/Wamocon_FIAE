'use client';

/**
 * HAI Message Component
 * 
 * Renders individual chat messages with modern styling.
 * User: Bubble, Right aligned.
 * HAI: Avatar + Text, Left aligned.
 */

import React from 'react';
import { HaiMessage as MessageType } from './HaiProvider';
import { MarkdownText } from '@/components/ui/MarkdownText';
import { motion } from 'framer-motion';
import { User } from 'lucide-react';

interface HaiMessageProps {
    message: MessageType;
}

export function HaiMessage({ message }: HaiMessageProps) {
    const isUser = message.role === 'user';
    const hasCitations = message.citations && message.citations.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-start gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
        >
            {/* Avatar */}
            <div className={`
        flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
        border border-white/10 shadow-sm
        ${isUser ? 'bg-[#1f2937]' : 'bg-cyan-500/10'}
      `}>
                {isUser ? (
                    <User className="w-4 h-4 text-gray-400" />
                ) : (
                    <span className="text-sm">🦈</span>
                )}
            </div>

            {/* Content */}
            <div className={`
        flex flex-col gap-1 max-w-[85%]
        ${isUser ? 'items-end' : 'items-start'}
      `}>
                <div className={`
          px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm
          ${isUser
                        ? 'bg-[#1f2937] text-gray-100 rounded-tr-sm'
                        : 'bg-transparent text-gray-200 pl-0 pt-1 shadow-none' // Assistant: No bubble
                    }
        `}>
                    <MarkdownText
                        className="
                            prose-code:text-gray-100 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded
                            prose-strong:text-white prose-strong:font-bold
                            prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline
                            prose-ul:list-disc prose-ul:pl-6 prose-ul:my-4
                            prose-ol:list-decimal prose-ol:pl-6 prose-ol:my-4
                            prose-li:text-gray-200 prose-li:my-2 prose-li:leading-relaxed
                            prose-li:marker:text-cyan-500
                            prose-p:text-gray-200 prose-p:leading-relaxed prose-p:mb-4
                            prose-headings:text-white prose-headings:font-bold prose-headings:mb-4 prose-headings:mt-6
                            prose-hr:border-white/10 prose-hr:my-6
                            max-w-none
                        "
                    >
                        {message.content}
                    </MarkdownText>
                </div>

                {/* Assistant Citations */}
                {!isUser && hasCitations && (
                    <div className="flex flex-wrap gap-2 mt-1 ml-0">
                        {message.citations?.map((citation, idx) => (
                            citation.url ? (
                                <a
                                    key={idx}
                                    href={citation.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="
                   text-[10px] px-2 py-1 rounded-md
                   bg-cyan-500/10 border border-cyan-500/20
                   text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300
                   cursor-pointer transition-colors flex items-center gap-1
                 "
                                    title="PDF öffnen"
                                >
                                    📚 {citation.title} ↗
                                </a>
                            ) : (
                                <div
                                    key={idx}
                                    className="
                   text-[10px] px-2 py-1 rounded-md
                   bg-cyan-500/5 border border-cyan-500/10
                   text-cyan-600/80 hover:bg-cyan-500/10
                   cursor-help transition-colors
                 "
                                    title="Quelle aus der Wissensdatenbank"
                                >
                                    📚 {citation.title}
                                </div>
                            )
                        ))}
                    </div>
                )}

                {/* Timestamp (Optional/Hover) */}
                {/* <span className="text-[10px] text-muted-foreground/50 px-1">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span> */}
            </div>
        </motion.div>
    );
}

export default HaiMessage;
