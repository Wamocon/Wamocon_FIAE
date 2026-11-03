'use client';

/**
 * HAI memory question card
 *
 * The HAI never saves something about a person silently. When it recognises a
 * preference or derives a weakness or the learning state, it asks here: "Soll ich
 * mir das merken?" with the buttons Yes, No and Change. Only the click calls the
 * server (done by the provider); "Change" lets the person correct the text first.
 * No keeps the proposal as rejected, so the HAI does not ask for it again.
 */

import React, { useState } from 'react';
import { Brain, Check, Loader2, Pencil, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { USER_MEMORY_MAX_CHARS } from '@/lib/hai/memory/config';
import type { HaiMemoryProposal } from './HaiProvider';

interface HaiMemoryCardProps {
  proposal: HaiMemoryProposal;
  onAnswer: (decision: 'confirm' | 'reject', content?: string) => void;
}

export function HaiMemoryCard({ proposal, onAnswer }: HaiMemoryCardProps) {
  const { t } = useLanguage();
  const { status } = proposal;
  const isOpen = status === 'open' || status === 'error';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal.content);

  return (
    <div
      role="group"
      aria-label={t('hai.memory.card.title')}
      data-testid="hai-memory-card"
      data-status={status}
      className="mt-2 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-gray-200"
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-400 uppercase">
        <Brain className="h-4 w-4" aria-hidden="true" />
        {t('hai.memory.card.title')}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        {t(`hai.memory.kind.${proposal.kind}`)}
      </p>

      {editing && isOpen ? (
        <div className="mt-1">
          <label htmlFor={`hai-memory-edit-${proposal.id}`} className="sr-only">
            {t('hai.memory.card.editLabel')}
          </label>
          <textarea
            id={`hai-memory-edit-${proposal.id}`}
            value={draft}
            maxLength={USER_MEMORY_MAX_CHARS}
            rows={3}
            onChange={e => setDraft(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/20 p-2 text-sm text-white focus:ring-1 focus:ring-cyan-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={draft.trim() === ''}
              onClick={() => onAnswer('confirm', draft.trim())}
              className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {t('hai.memory.card.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(proposal.content);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t('hai.memory.card.cancelEdit')}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 font-medium text-white">{proposal.content}</p>
      )}

      {isOpen && !editing && (
        <>
          <p className="mt-1 text-xs text-gray-400">
            {t('hai.memory.card.hint')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onAnswer('confirm')}
              className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {t('hai.memory.card.yes')}
            </button>
            <button
              type="button"
              onClick={() => onAnswer('reject')}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t('hai.memory.card.no')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {t('hai.memory.card.change')}
            </button>
          </div>
        </>
      )}

      {status === 'running' && (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-2 text-xs text-gray-300"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t('hai.memory.card.running')}
        </p>
      )}

      {status === 'saved' && (
        <p role="status" className="mt-3 text-xs text-emerald-400">
          {t('hai.memory.card.saved')}
        </p>
      )}

      {status === 'rejected' && (
        <p role="status" className="mt-3 text-xs text-gray-400">
          {t('hai.memory.card.rejected')}
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {t(`hai.memory.card.error.${proposal.errorKey ?? 'generic'}`)}
        </p>
      )}
    </div>
  );
}
