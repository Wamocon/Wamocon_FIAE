'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Minimize2 } from 'lucide-react';
import {
  preloadedConversation,
  demoResponses,
  type DemoHaiMessage,
} from './data/demoHaiMessages';

export function DemoHaiChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<DemoHaiMessage[]>(preloadedConversation);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const responseIndex = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen, scrollToBottom]);

  const handleSend = () => {
    if (!input.trim() || isTyping) return;

    const userMsg: DemoHaiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response after delay
    setTimeout(() => {
      const response: DemoHaiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: demoResponses[responseIndex.current % demoResponses.length],
        timestamp: new Date().toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      responseIndex.current++;
      setMessages(prev => [...prev, response]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <>
      {/* Chat Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-2xl shadow-2xl transition-all duration-200 hover:scale-110 hover:shadow-blue-500/30"
          aria-label="HAI Chat öffnen"
        >
          🦈
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-[70] flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🦈</span>
              <div>
                <h3 className="text-sm font-semibold text-white">HAI Assistant</h3>
                <p className="text-[10px] text-blue-200">Demo Modus</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-muted/50 text-foreground'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                      {msg.content.split(/(`{3}[\s\S]*?`{3}|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
                        if (part.startsWith('```') && part.endsWith('```')) {
                          const code = part.slice(3, -3).replace(/^[a-z]+\n/, '');
                          return (
                            <pre
                              key={i}
                              className="my-2 overflow-x-auto rounded-lg bg-black/20 p-2 text-xs"
                            >
                              <code>{code}</code>
                            </pre>
                          );
                        }
                        if (part.startsWith('`') && part.endsWith('`')) {
                          return (
                            <code key={i} className="rounded bg-black/20 px-1 text-xs">
                              {part.slice(1, -1)}
                            </code>
                          );
                        }
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <strong key={i}>{part.slice(2, -2)}</strong>;
                        }
                        return <span key={i}>{part}</span>;
                      })}
                    </div>
                    <p
                      className={`mt-1 text-[10px] ${
                        msg.role === 'user' ? 'text-blue-200' : 'text-muted-foreground'
                      }`}
                    >
                      {msg.timestamp}
                    </p>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-muted/50 px-4 py-3">
                    <div className="flex gap-1">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-border/50 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Nachricht schreiben..."
                disabled={isTyping}
                className="flex-1 rounded-xl border border-border/50 bg-background/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white transition-all hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
