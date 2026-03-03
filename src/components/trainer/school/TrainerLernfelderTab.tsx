'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Layers,
  Plus,
  Trash2,
  Search,
  BookOpen,
  ArrowRight,
} from 'lucide-react';

export function TrainerLernfelderTab() {
  const router = useRouter();
  const { t } = useLanguage();
  const [lernfelder, setLernfelder] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Create/Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLabel, setNewLabel] = useState('LF-1');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/trainer/lernfelder', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        setLernfelder(data.lernfelder || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const usedLabels = useMemo(() => {
    const labels = new Set<string>();
    lernfelder.forEach(lf => {
      if (!isEditing || lf.id !== currentId) {
        labels.add(lf.label);
      }
    });
    return labels;
  }, [lernfelder, isEditing, currentId]);

  const availableLabels = useMemo(() => {
    const all = Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`);
    return all.map(lbl => ({
      label: lbl,
      disabled: usedLabels.has(lbl),
    }));
  }, [usedLabels]);

  const filteredLernfelder = useMemo(() => {
    if (!searchTerm) return lernfelder;
    return lernfelder.filter(
      lf =>
        lf.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lf.label.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [lernfelder, searchTerm]);

  const openCreate = () => {
    setIsEditing(false);
    setNewTitle('');
    setNewDesc('');
    const firstAvailable = Array.from(
      { length: 12 },
      (_, i) => `LF-${i + 1}`
    ).find(l => !usedLabels.has(l));
    setNewLabel(firstAvailable || 'LF-1');
    setShowModal(true);
  };

  const openEdit = (e: React.MouseEvent, lf: any) => {
    e.stopPropagation();
    setIsEditing(true);
    setCurrentId(lf.id);
    setNewTitle(lf.title);
    setNewDesc(lf.description || '');
    setNewLabel(lf.label);
    setShowModal(true);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t('lernfelder.deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/trainer/lernfelder/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLernfelder(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async () => {
    if (!newTitle) return;
    setSubmitting(true);
    try {
      if (isEditing && currentId) {
        const res = await fetch(`/api/trainer/lernfelder/${currentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newTitle,
            description: newDesc,
            label: newLabel,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setLernfelder(prev =>
            prev.map(lf =>
              lf.id === currentId
                ? { ...lf, ...data.lernfeld, useCaseCount: lf.useCaseCount }
                : lf
            )
          );
          setShowModal(false);
        }
      } else {
        const res = await fetch('/api/trainer/lernfelder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newTitle,
            description: newDesc,
            label: newLabel,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setLernfelder(prev => [
            ...prev,
            { ...data.lernfelder, useCaseCount: 0 },
          ]);
          setShowModal(false);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-foreground text-2xl font-bold">
              {t('lernfelder.title')}
            </h2>
            <p className="text-muted text-sm">{t('lernfelder.overview')}</p>
          </div>
          <button
            onClick={openCreate}
            className="bg-primary from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-primary-foreground flex items-center gap-2 rounded-xl bg-gradient-to-r px-5 py-2.5 font-medium shadow-lg transition-all duration-200 hover:shadow-xl"
          >
            <Plus className="h-4 w-4" />
            {t('lernfelder.new')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="glass-effect border-accent/30 rounded-2xl border p-4 shadow-lg">
        <div className="relative max-w-md">
          <Search className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder={t('lernfelder.search')}
            className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-xl border py-2.5 pr-4 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Grid - Compact Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredLernfelder.map(lf => (
          <div
            key={lf.id}
            onClick={() => router.push(`/trainer/lernfelder/${lf.id}`)}
            className="group glass-effect border-accent/20 from-card via-card to-accent/5 hover:border-accent/50 hover:shadow-accent/10 relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-md transition-all duration-300 hover:shadow-xl"
          >
            {/* Decorative gradient orb */}
            <div className="from-accent/20 to-primary/10 group-hover:from-accent/30 absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br blur-2xl transition-all duration-500 group-hover:scale-150" />

            {/* Header: Icon + Label */}
            <div className="relative mb-3 flex items-center justify-between">
              <div className="bg-primary from-accent to-primary shadow-accent/25 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg">
                <Layers className="text-primary-foreground h-5 w-5" />
              </div>
              <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-bold shadow-sm">
                {lf.label}
              </span>
            </div>

            {/* Title */}
            <h3 className="text-foreground group-hover:text-accent mb-2 line-clamp-2 h-12 text-base font-semibold transition-colors">
              {lf.title}
            </h3>

            {/* Description */}
            <div className="mb-3 h-8">
              {lf.description ? (
                <p className="text-muted-foreground line-clamp-2 text-xs">
                  {lf.description}
                </p>
              ) : (
                <p className="text-muted-foreground/50 text-xs italic">
                  {t('lernfelder.noDescription')}
                </p>
              )}
            </div>

            {/* Stats Row */}
            <div className="bg-muted/20 mt-auto mb-3 flex items-center justify-between rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <BookOpen className="text-accent h-4 w-4" />
                <span className="text-foreground text-sm font-medium">
                  {t('lernfelder.useCases')}
                </span>
              </div>
              <span className="text-accent font-bold">
                {lf.useCaseCount || 0}
              </span>
            </div>

            {/* Actions Footer */}
            <div className="border-accent/10 flex items-center justify-between border-t pt-2">
              <button
                onClick={e => openEdit(e, lf)}
                className="text-accent hover:text-accent/80 flex items-center gap-1 text-sm font-medium transition-colors"
              >
                {t('common.edit')}
                <ArrowRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </button>
              <button
                onClick={e => handleDelete(e, lf.id)}
                className="text-muted-foreground rounded-lg p-1.5 transition-all hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {!loading && filteredLernfelder.length === 0 && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-accent/20 to-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
            <Layers className="text-accent h-8 w-8" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-semibold">
            {t('lernfelder.notFound')}
          </h3>
          <p className="text-muted mb-4 text-sm">
            {searchTerm
              ? t('lernfelder.tryDifferentSearch')
              : t('lernfelder.createFirst')}
          </p>
          <button
            onClick={openCreate}
            className="from-accent to-primary text-foreground rounded-xl bg-gradient-to-r px-5 py-2 font-medium"
          >
            {t('lernfelder.create')}
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm duration-200">
          <div className="border-accent/20 bg-card w-full max-w-md rounded-2xl border p-6 shadow-2xl">
            <h2 className="text-foreground mb-4 text-xl font-bold">
              {isEditing ? t('lernfelder.edit') : t('lernfelder.new')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">
                  {t('lernfelder.titleLabel')}
                </label>
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="border-accent/20 bg-background text-foreground placeholder:text-muted focus:border-accent focus:ring-accent/20 w-full rounded-xl border px-3 py-2.5 focus:ring-2 focus:outline-none"
                  placeholder={t('lernfelder.titlePlaceholder')}
                />
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">
                  {t('lernfelder.descriptionLabel')}
                </label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="border-accent/20 bg-background text-foreground placeholder:text-muted focus:border-accent focus:ring-accent/20 w-full rounded-xl border px-3 py-2.5 focus:ring-2 focus:outline-none"
                  rows={3}
                  placeholder={t('lernfelder.descriptionPlaceholder')}
                />
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">
                  {t('lernfelder.label')}
                </label>
                <select
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  className="border-accent/20 bg-background text-foreground focus:border-accent focus:ring-accent/20 w-full rounded-xl border px-3 py-2.5 focus:ring-2 focus:outline-none"
                >
                  {availableLabels.map(opt => (
                    <option
                      key={opt.label}
                      value={opt.label}
                      disabled={opt.disabled}
                    >
                      {opt.label}{' '}
                      {opt.disabled ? t('lernfelder.labelTaken') : ''}
                    </option>
                  ))}
                </select>
                <p className="text-muted mt-1 text-xs">
                  {t('lernfelder.labelInfo')}
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="border-accent/20 text-foreground hover:bg-accent/5 rounded-xl border px-4 py-2 text-sm font-medium transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !newTitle.trim()}
                  className="from-accent to-primary rounded-xl bg-gradient-to-r px-5 py-2 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl disabled:opacity-50"
                >
                  {isEditing ? t('common.save') : t('common.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
