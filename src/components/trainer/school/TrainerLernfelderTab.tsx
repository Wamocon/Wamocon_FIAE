'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Plus, Trash2, Search, BookOpen, ArrowRight } from 'lucide-react';

export function TrainerLernfelderTab() {
    const router = useRouter();
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
        fetch('/api/trainer/lernfelder')
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
            disabled: usedLabels.has(lbl)
        }));
    }, [usedLabels]);

    const filteredLernfelder = useMemo(() => {
        if (!searchTerm) return lernfelder;
        return lernfelder.filter(lf =>
            lf.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            lf.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [lernfelder, searchTerm]);

    const openCreate = () => {
        setIsEditing(false);
        setNewTitle('');
        setNewDesc('');
        const firstAvailable = Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`).find(l => !usedLabels.has(l));
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
        if (!confirm('Sind Sie sicher, dass Sie dieses Lernfeld löschen möchten?')) return;
        try {
            const res = await fetch(`/api/trainer/lernfelder/${id}`, { method: 'DELETE' });
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
                    body: JSON.stringify({ title: newTitle, description: newDesc, label: newLabel })
                });
                if (res.ok) {
                    const data = await res.json();
                    setLernfelder(prev => prev.map(lf => lf.id === currentId ? { ...lf, ...data.lernfeld, useCaseCount: lf.useCaseCount } : lf));
                    setShowModal(false);
                }
            } else {
                const res = await fetch('/api/trainer/lernfelder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle, description: newDesc, label: newLabel })
                });
                if (res.ok) {
                    const data = await res.json();
                    setLernfelder(prev => [...prev, { ...data.lernfelder, useCaseCount: 0 }]);
                    setShowModal(false);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="border-accent/30 border-t-accent h-8 w-8 animate-spin rounded-full border-4"></div></div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-foreground text-2xl font-bold">Lernfelder</h2>
                        <p className="text-muted text-sm">Übersicht aller Lernfelder und zugehöriger Use Cases</p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-primary from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex items-center gap-2 rounded-xl bg-gradient-to-r px-5 py-2.5 font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:shadow-xl"
                    >
                        <Plus className="h-4 w-4" />
                        Neues Lernfeld
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="glass-effect border-accent/30 rounded-2xl border p-4 shadow-lg">
                <div className="relative max-w-md">
                    <Search className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Nach Lernfeldern suchen..."
                        className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-xl border py-2.5 pr-4 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* Grid - Compact Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredLernfelder.map((lf) => (
                    <div
                        key={lf.id}
                        onClick={() => router.push(`/trainer/lernfelder/${lf.id}`)}
                        className="group glass-effect relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-card via-card to-accent/5 p-5 shadow-md transition-all duration-300 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10 cursor-pointer h-full flex flex-col"
                    >
                        {/* Decorative gradient orb */}
                        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-accent/20 to-primary/10 blur-2xl transition-all duration-500 group-hover:scale-150 group-hover:from-accent/30" />

                        {/* Header: Icon + Label */}
                        <div className="relative flex items-center justify-between mb-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary bg-gradient-to-br from-accent to-primary shadow-lg shadow-accent/25">
                                <Layers className="h-5 w-5 text-primary-foreground" />
                            </div>
                            <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground shadow-sm">
                                {lf.label}
                            </span>
                        </div>

                        {/* Title */}
                        <h3 className="text-foreground font-semibold text-base mb-2 line-clamp-2 group-hover:text-accent transition-colors h-12">
                            {lf.title}
                        </h3>

                        {/* Description */}
                        <div className="mb-3 h-8">
                            {lf.description ? (
                                <p className="text-muted-foreground text-xs line-clamp-2">
                                    {lf.description}
                                </p>
                            ) : (
                                <p className="text-muted-foreground/50 text-xs italic">
                                    Keine Beschreibung
                                </p>
                            )}
                        </div>

                        {/* Stats Row */}
                        <div className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2 mb-3 mt-auto">
                            <div className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-accent" />
                                <span className="text-foreground text-sm font-medium">Use Cases</span>
                            </div>
                            <span className="text-accent font-bold">{lf.useCaseCount || 0}</span>
                        </div>

                        {/* Actions Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-accent/10">
                            <button
                                onClick={(e) => openEdit(e, lf)}
                                className="text-accent hover:text-accent/80 text-sm font-medium flex items-center gap-1 transition-colors"
                            >
                                Bearbeiten
                                <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </button>
                            <button
                                onClick={(e) => handleDelete(e, lf.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
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
                    <h3 className="text-foreground mb-2 text-lg font-semibold">Keine Lernfelder gefunden</h3>
                    <p className="text-muted text-sm mb-4">
                        {searchTerm ? 'Versuchen Sie andere Suchbegriffe.' : 'Erstellen Sie Ihr erstes Lernfeld.'}
                    </p>
                    <button
                        onClick={openCreate}
                        className="from-accent to-primary rounded-xl bg-gradient-to-r px-5 py-2 font-medium text-foreground"
                    >
                        Lernfeld erstellen
                    </button>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-2xl border border-accent/20 bg-card p-6 shadow-2xl">
                        <h2 className="mb-4 text-xl font-bold text-foreground">{isEditing ? 'Lernfeld bearbeiten' : 'Neues Lernfeld'}</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Titel *</label>
                                <input
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                    placeholder="z.B. IT-Systeme bereitstellen"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Beschreibung</label>
                                <textarea
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                    rows={3}
                                    placeholder="Kurze Beschreibung des Lernfelds..."
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Lernfeld-Label *</label>
                                <select
                                    value={newLabel}
                                    onChange={(e) => setNewLabel(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                >
                                    {availableLabels.map(opt => (
                                        <option key={opt.label} value={opt.label} disabled={opt.disabled}>
                                            {opt.label} {opt.disabled ? '(Vergeben)' : ''}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-muted">Jedes Lernfeld benötigt ein eindeutiges Label (LF-1 bis LF-12).</p>
                            </div>
                            <div className="flex justify-end gap-3 pt-3">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="rounded-xl border border-accent/20 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/5 transition-colors"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || !newTitle.trim()}
                                    className="rounded-xl bg-gradient-to-r from-accent to-primary px-5 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-50 transition-all hover:shadow-xl"
                                >
                                    {isEditing ? 'Speichern' : 'Erstellen'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
