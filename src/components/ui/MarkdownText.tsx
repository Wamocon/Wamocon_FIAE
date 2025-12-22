'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// Import highlight.js styles for code blocks
import 'highlight.js/styles/github-dark.css';

interface MarkdownTextProps {
    children: string;
    className?: string;
    /** Enable syntax highlighting for code blocks */
    highlightCode?: boolean;
    /** Render inline (no block-level elements like <p>) */
    inline?: boolean;
}

/**
 * MarkdownText - Renders markdown content with optional syntax highlighting
 * 
 * Supports:
 * - **bold** and *italic* text
 * - `inline code` and ```code blocks```
 * - Tables, lists, and other GFM features
 * - Syntax highlighting for code blocks (Python, SQL, JavaScript, etc.)
 * 
 * @example
 * <MarkdownText>Was passiert, wenn `def func(a, b=1):` aufgerufen wird?</MarkdownText>
 */
export function MarkdownText({
    children,
    className = '',
    highlightCode = true,
    inline = false,
}: MarkdownTextProps) {
    if (!children) return null;

    // Base styling for markdown content
    const baseClasses = `
    prose prose-invert prose-sm max-w-none
    prose-code:before:content-[''] prose-code:after:content-['']
    prose-code:bg-accent/20 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-foreground
    prose-pre:bg-black/40 prose-pre:border prose-pre:border-accent/20 prose-pre:rounded-lg
    prose-p:my-1 prose-p:leading-relaxed
    prose-strong:text-foreground prose-strong:font-semibold
    ${inline ? 'inline' : ''}
    ${className}
  `.trim();

    return (
        <div className={baseClasses}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={highlightCode ? [rehypeHighlight] : []}
                components={{
                    // Override paragraph to avoid extra margins in inline mode
                    p: ({ children }) => inline ? <span>{children}</span> : <p className="my-1">{children}</p>,
                    // Style inline code
                    code: ({ node, className, children, ...props }) => {
                        const isBlock = className?.includes('language-') || String(children).includes('\n');
                        if (isBlock) {
                            return (
                                <code className={`${className || ''} block overflow-x-auto`} {...props}>
                                    {children}
                                </code>
                            );
                        }
                        return (
                            <code className="bg-accent/20 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                                {children}
                            </code>
                        );
                    },
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}

export default MarkdownText;
