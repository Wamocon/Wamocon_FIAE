'use client';

/**
 * Admin page "HAI-Gedächtnis" (platform admin only): the shared memory of the HAI
 * for all users. Proposals (with the number of users they rest on), approved and
 * rejected entries, a button to calculate new proposals, a form for an own entry.
 *
 * This page NEVER shows an entry of one person. The memory of a user lives in a
 * table that no admin route reads, the proposals carry a count only. The routes
 * behind it (/api/admin/hai/memory) check the platform admin themselves, hiding
 * the page is not the protection.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Brain, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { GLOBAL_MEMORY_MAX_CHARS } from '@/lib/hai/memory/config';

type Entry = {
  id: string;
  catalogId: string | null;
  content: string;
  status: 'proposed' | 'approved' | 'rejected';
  origin: 'auto' | 'manual';
  supportCount: number;
  createdAt: string;
};

type Overview = {
  available: boolean;
  k?: number;
  catalogs?: Array<{ id: string; code: string; title: string }>;
  entries?: Entry[];
};

const SECTIONS: Array<Entry['status']> = ['proposed', 'approved', 'rejected'];

export function HaiMemoryAdminView() {
  const { t } = useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newContent, setNewContent] = useState('');
  const [newCatalog, setNewCatalog] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/hai/memory', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('load');
      setOverview(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (
    input: string,
    init: RequestInit,
    okMessage?: string
  ): Promise<Response | null> => {
    setBusy(true);
    try {
      const res = await authFetch(input, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        toast.error(
          res.status === 422
            ? t('admin.haiMemory.contentRejected')
            : t('admin.haiMemory.saveFailed')
        );
        return null;
      }
      if (okMessage) toast.success(okMessage);
      await load();
      return res;
    } catch {
      toast.error(t('admin.haiMemory.saveFailed'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const stopEditing = (id: string) =>
    setEditing(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const decide = (
    id: string,
    body: { status?: 'approved' | 'rejected'; content?: string }
  ) =>
    call(`/api/admin/hai/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

  const suggest = async () => {
    const res = await call('/api/admin/hai/memory/suggest', { method: 'POST' });
    if (!res) return;
    const data = (await res.json().catch(() => null)) as {
      created?: number;
      updated?: number;
      k?: number;
    } | null;
    toast.success(
      t('admin.haiMemory.suggestDone', {
        created: String(data?.created ?? 0),
        updated: String(data?.updated ?? 0),
      })
    );
  };

  const create = async () => {
    const res = await call(
      '/api/admin/hai/memory',
      {
        method: 'POST',
        body: JSON.stringify({
          content: newContent.trim(),
          catalogId: newCatalog === '' ? null : newCatalog,
          approve: true,
        }),
      },
      t('admin.haiMemory.created')
    );
    if (res) {
      setNewContent('');
      setNewCatalog('');
    }
  };

  if (!overview && !loadError) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const scopeLabel = (catalogId: string | null) =>
    catalogId === null
      ? t('admin.haiMemory.scopeAll')
      : (overview?.catalogs?.find(c => c.id === catalogId)?.title ??
        t('admin.haiMemory.scopeUnknown'));

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Brain className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('admin.haiMemory.title')}
            </h1>
            <p className="text-muted">{t('admin.haiMemory.subtitle')}</p>
          </div>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-red-500">
          {t('admin.haiMemory.loadFailed')}
        </p>
      )}

      {overview && !overview.available && (
        <p role="status" className="text-muted text-sm">
          {t('admin.haiMemory.notAvailable')}
        </p>
      )}

      {overview?.available && (
        <>
          <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <ShieldCheck className="text-accent h-6 w-6" />
              <h2 className="text-foreground text-xl font-bold">
                {t('admin.haiMemory.privacy.title')}
              </h2>
            </div>
            <p className="text-muted text-sm">
              {t('admin.haiMemory.privacy.text', {
                k: String(overview.k ?? 5),
              })}
            </p>
            <div className="mt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void suggest()}
                className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t('admin.haiMemory.suggest')}
              </button>
            </div>
          </section>

          {SECTIONS.map(status => {
            const rows = (overview.entries ?? []).filter(
              e => e.status === status
            );
            return (
              <section
                key={status}
                data-testid={`hai-memory-admin-${status}`}
                className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg"
              >
                <h2 className="text-foreground mb-4 text-xl font-bold">
                  {t(`admin.haiMemory.section.${status}`)} ({rows.length})
                </h2>
                {rows.length === 0 ? (
                  <p className="text-muted text-sm">
                    {t('admin.haiMemory.sectionEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {rows.map(entry => {
                      const draft = editing[entry.id];
                      return (
                        <li
                          key={entry.id}
                          data-testid="hai-memory-admin-entry"
                          className="border-border rounded-2xl border p-4"
                        >
                          <div className="text-muted mb-2 flex flex-wrap gap-3 text-xs">
                            <span>{scopeLabel(entry.catalogId)}</span>
                            <span>
                              {t(`admin.haiMemory.origin.${entry.origin}`)}
                            </span>
                            {entry.origin === 'auto' && (
                              <span>
                                {t('admin.haiMemory.support', {
                                  count: String(entry.supportCount),
                                })}
                              </span>
                            )}
                          </div>
                          {draft === undefined ? (
                            <p className="text-foreground text-sm">
                              {entry.content}
                            </p>
                          ) : (
                            <textarea
                              aria-label={t('admin.haiMemory.editLabel')}
                              value={draft}
                              maxLength={GLOBAL_MEMORY_MAX_CHARS}
                              rows={3}
                              onChange={e =>
                                setEditing(prev => ({
                                  ...prev,
                                  [entry.id]: e.target.value,
                                }))
                              }
                              className="bg-background border-border text-foreground w-full rounded-xl border p-3 text-sm"
                            />
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {status !== 'approved' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void decide(entry.id, {
                                    status: 'approved',
                                    ...(draft !== undefined
                                      ? { content: draft.trim() }
                                      : {}),
                                  }).then(() => stopEditing(entry.id))
                                }
                                className="bg-accent text-accent-foreground rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                              >
                                {t('admin.haiMemory.approve')}
                              </button>
                            )}
                            {status === 'proposed' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void decide(entry.id, { status: 'rejected' })
                                }
                                className="border-border rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                              >
                                {t('admin.haiMemory.reject')}
                              </button>
                            )}
                            {status === 'approved' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void decide(entry.id, { status: 'rejected' })
                                }
                                className="border-border rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                              >
                                {t('admin.haiMemory.deactivate')}
                              </button>
                            )}
                            {draft === undefined ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing(prev => ({
                                    ...prev,
                                    [entry.id]: entry.content,
                                  }))
                                }
                                className="border-border rounded-lg border px-3 py-1.5 text-xs"
                              >
                                {t('admin.haiMemory.edit')}
                              </button>
                            ) : (
                              <>
                                {status === 'approved' && (
                                  <button
                                    type="button"
                                    disabled={busy || draft.trim() === ''}
                                    onClick={() =>
                                      void decide(entry.id, {
                                        content: draft.trim(),
                                      }).then(() => stopEditing(entry.id))
                                    }
                                    className="border-border rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                                  >
                                    {t('admin.haiMemory.saveText')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => stopEditing(entry.id)}
                                  className="border-border rounded-lg border px-3 py-1.5 text-xs"
                                >
                                  {t('admin.haiMemory.cancel')}
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}

          <section className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
            <h2 className="text-foreground mb-2 text-xl font-bold">
              {t('admin.haiMemory.new.title')}
            </h2>
            <p className="text-muted mb-4 text-sm">
              {t('admin.haiMemory.new.hint')}
            </p>
            <label
              htmlFor="hai-memory-new-text"
              className="text-foreground mb-1.5 block text-sm font-medium"
            >
              {t('admin.haiMemory.new.text')}
            </label>
            <textarea
              id="hai-memory-new-text"
              value={newContent}
              maxLength={GLOBAL_MEMORY_MAX_CHARS}
              rows={3}
              onChange={e => setNewContent(e.target.value)}
              className="bg-background border-border text-foreground w-full rounded-xl border p-3 text-sm"
            />
            <label
              htmlFor="hai-memory-new-scope"
              className="text-foreground mt-4 mb-1.5 block text-sm font-medium"
            >
              {t('admin.haiMemory.new.scope')}
            </label>
            <select
              id="hai-memory-new-scope"
              value={newCatalog}
              onChange={e => setNewCatalog(e.target.value)}
              className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 md:w-1/2"
            >
              <option value="">{t('admin.haiMemory.scopeAll')}</option>
              {(overview.catalogs ?? []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={busy || newContent.trim() === ''}
                onClick={() => void create()}
                className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
              >
                {t('admin.haiMemory.new.create')}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
