'use client';

/**
 * "Mein HAI-Gedächtnis": the section of the profile (trainee and trainer) where a
 * person sees, changes and deletes what the HAI remembers about them, and turns
 * the memory on or off.
 *
 * Only the person sees this: the entries come from GET /api/hai/memory, which
 * answers for the session user only. The section shows nothing while the feature
 * is not available (switch HAI_MEMORY off on the server) or the list cannot be
 * loaded. Entries are listed per occupation. An open proposal (the person has not
 * answered the question of the HAI yet) can be taken over or turned down here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { USER_MEMORY_MAX_CHARS } from '@/lib/hai/memory/config';
import {
  decideMemory,
  deleteAllMemory,
  deleteMemory,
  editMemory,
  fetchMemory,
  setMemoryEnabled,
  type MemoryCallResult,
  type MemoryEntryDto,
  type MemoryOverview,
} from '@/lib/hai/memory/client';

export function HaiMemoryPanel() {
  const { t } = useLanguage();
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchMemory();
    setOverview(result.ok && result.data?.available ? result.data : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const failure = (result: MemoryCallResult<unknown>) =>
    toast.error(
      !result.ok && result.status === 422
        ? t('hai.memory.card.error.content')
        : t('hai.memory.panel.saveFailed')
    );

  const run = async (action: () => Promise<MemoryCallResult<unknown>>) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        failure(result);
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  };

  if (!overview) return null;

  const hasEntries = overview.occupations.some(o => o.entries.length > 0);

  const startEdit = (entry: MemoryEntryDto) => {
    setEditingId(entry.id);
    setDraft(entry.content);
  };

  return (
    <section
      data-testid="hai-memory-panel"
      aria-labelledby="hai-memory-title"
      className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg"
    >
      <div className="mb-3 flex items-center gap-3">
        <Brain className="text-accent h-6 w-6" aria-hidden="true" />
        <h2 id="hai-memory-title" className="text-foreground text-lg font-bold">
          {t('hai.memory.panel.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-2 text-sm">
        {t('hai.memory.panel.what')}
      </p>
      <p className="text-muted-foreground mb-4 text-sm font-medium">
        {t('hai.memory.panel.privacy')}
      </p>

      <label className="mb-1 flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          role="switch"
          checked={overview.enabled}
          disabled={busy}
          onChange={e => void run(() => setMemoryEnabled(e.target.checked))}
          className="h-4 w-4"
        />
        <span className="text-foreground font-medium">
          {t('hai.memory.panel.switch')}
        </span>
      </label>
      {!overview.enabled && (
        <p className="text-muted-foreground mb-2 text-xs">
          {t('hai.memory.panel.switchOff')}
        </p>
      )}

      <div className="mt-4 space-y-5">
        {overview.occupations.map(occupation => (
          <div
            key={occupation.id}
            data-testid={`hai-memory-occupation-${occupation.code}`}
          >
            <h3 className="text-foreground mb-2 text-sm font-semibold">
              {occupation.title}
            </h3>
            {occupation.entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('hai.memory.panel.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {occupation.entries.map(entry => (
                  <li
                    key={entry.id}
                    className="border-border rounded-xl border p-3 text-sm"
                    data-testid="hai-memory-entry"
                  >
                    <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span>{t(`hai.memory.kind.${entry.kind}`)}</span>
                      {entry.status === 'proposed' && (
                        <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-yellow-500">
                          {t('hai.memory.panel.proposed')}
                        </span>
                      )}
                    </div>
                    {editingId === entry.id ? (
                      <div>
                        <textarea
                          aria-label={t('hai.memory.card.editLabel')}
                          value={draft}
                          maxLength={USER_MEMORY_MAX_CHARS}
                          rows={3}
                          onChange={e => setDraft(e.target.value)}
                          className="bg-background border-border text-foreground w-full rounded-lg border p-2"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={busy || draft.trim() === ''}
                            onClick={async () => {
                              if (
                                await run(() =>
                                  entry.status === 'proposed'
                                    ? decideMemory(
                                        entry.id,
                                        'confirm',
                                        draft.trim()
                                      )
                                    : editMemory(entry.id, draft.trim())
                                )
                              ) {
                                setEditingId(null);
                              }
                            }}
                            className="bg-accent text-accent-foreground rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            {t('hai.memory.card.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="border-border rounded-lg border px-3 py-1.5 text-xs"
                          >
                            {t('hai.memory.card.cancelEdit')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-foreground">{entry.content}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {entry.status === 'proposed' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    decideMemory(entry.id, 'confirm')
                                  )
                                }
                                className="border-border inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
                              >
                                <Check className="h-3 w-3" aria-hidden="true" />
                                {t('hai.memory.card.yes')}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    decideMemory(entry.id, 'reject')
                                  )
                                }
                                className="border-border inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                                {t('hai.memory.card.no')}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startEdit(entry)}
                            className="border-border inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            {t('hai.memory.panel.edit')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() => deleteMemory(entry.id))
                            }
                            className="border-border inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-red-500"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            {t('hai.memory.panel.delete')}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {hasEntries && (
        <div className="mt-5">
          {confirmAll ? (
            <div role="alert" className="text-sm">
              <p className="text-foreground mb-2">
                {t('hai.memory.panel.deleteAllConfirm')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => deleteAllMemory())) {
                      setConfirmAll(false);
                    }
                  }}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {t('hai.memory.panel.deleteAllYes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAll(false)}
                  className="border-border rounded-lg border px-3 py-1.5 text-xs"
                >
                  {t('hai.memory.card.cancelEdit')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              className="border-border rounded-xl border px-4 py-2 text-sm text-red-500"
            >
              {t('hai.memory.panel.deleteAll')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
