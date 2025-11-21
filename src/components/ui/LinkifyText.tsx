'use client';

import React from 'react';

type Props = {
  text: string;
  className?: string;
  preserveLineBreaks?: boolean;
};

// Basic URL regex to catch http(s) and www. links, avoiding spaces and angle brackets
const URL_REGEX = /((https?:\/\/|www\.)[^\s<]+)/gi;

function normalizeUrl(url: string): string {
  // Trim trailing punctuation commonly attached in prose
  const trimmed = url.replace(/[),.;!?]+$/g, '');
  if (trimmed.startsWith('www.')) return `http://${trimmed}`;
  return trimmed;
}

export function LinkifyText({ text, className, preserveLineBreaks = true }: Props) {
  const parts: React.ReactNode[] = [];

  const pushWithLinks = (segment: string) => {
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const regex = new RegExp(URL_REGEX);
    while ((match = regex.exec(segment)) !== null) {
      const before = segment.slice(lastIndex, match.index);
      if (before) parts.push(before);
      const raw = match[0];
      const href = normalizeUrl(raw);
      parts.push(
        <a key={`${href}-${lastIndex}`} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {raw}
        </a>
      );
      lastIndex = match.index + raw.length;
    }
    const rest = segment.slice(lastIndex);
    if (rest) parts.push(rest);
  };

  if (preserveLineBreaks) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      pushWithLinks(line);
      if (i < lines.length - 1) parts.push(<br key={`br-${i}`} />);
    });
  } else {
    pushWithLinks(text);
  }

  return <span className={className}>{parts}</span>;
}

export default LinkifyText;
