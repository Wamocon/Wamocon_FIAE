'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock, Layers, Edit2, Trash2, X, ArrowRight, FileText } from 'lucide-react';

export default function TrainerLernfeldDetailPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const id = params?.id as string;
    const [data, setData] = useState<{ lernfeld: any; useCases: any[] } | null>(null);
    const [loading, setLoading] = useState(true);

    // Edit Modal
    const [showEdit, setShowEdit] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editLabel, setEditLabel] = useState('');
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        if (id) {
            fetchLernfeld();
        }
    }, [id]);

    const fetchLernfeld = () => {
        fetch(`/api/trainer/lernfelder/${id}`)
            .then(res => res.json())
            .then(d => {
                setData(d);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    const handleEditOpen = () => {
        if (!data) return;
        setEditTitle(data.lernfeld.title);
        setEditDesc(data.lernfeld.description || '');
        setEditLabel(data.lernfeld.label);
        setShowEdit(true);
    };

    const handleUpdate = async () => {
        if (!editTitle || !editLabel) return;
        setProcessing(true);
        try {
            const res = await fetch(`/api/trainer/lernfelder/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: editTitle, description: editDesc, label: editLabel })
            });
            if (res.ok) {
                setShowEdit(false);
                fetchLernfeld();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setProcessing(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Sind Sie sicher, dass Sie dieses Lernfeld löschen möchten?')) return;
        setProcessing(true);
        try {
            const res = await fetch(`/api/trainer/lernfelder/${id}`, { method: 'DELETE' });
            if (res.ok) {
                router.push('/trainer/lernfelder');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="border-accent/30 border-t-accent h-8 w-8 animate-spin rounded-full border-4"></div>
        </div>
    );

    if (!data || !data.lernfeld) return (
        <div className="mx-auto max-w-7xl p-6">
            <div className="glass-effect border-accent/30 rounded-2xl border p-8 text-center">
                <Layers className="h-12 w-12 mx-auto text-muted mb-3" />
                <p className="text-muted-foreground">Lernfeld nicht gefunden</p>
                <button onClick={() => router.back()} className="mt-4 text-accent hover:underline">Zurück</button>
            </div>
        </div>
    );

    const { lernfeld, useCases } = data;

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-6">
            {/* Header Card */}
            <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-start gap-4">
                        <button
                            onClick={() => router.back()}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 hover:bg-accent/20 transition-colors shrink-0"
                        >
                            <ArrowLeft className="h-5 w-5 text-accent" />
                        </button>
                        <div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-white shadow-sm">
                                    {lernfeld.label}
                                </span>
                                <h1 className="text-2xl font-bold text-foreground">{lernfeld.title}</h1>
                            </div>
                            {lernfeld.description ? (
                                <p className="text-muted-foreground text-sm max-w-2xl">{lernfeld.description}</p>
                            ) : (
                                <p className="text-muted-foreground/50 text-sm italic">Keine Beschreibung vorhanden</p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                        <button
                            onClick={handleEditOpen}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-accent/20 bg-accent/5 hover:bg-accent/10 text-foreground text-sm font-medium transition-colors"
                        >
                            <Edit2 className="h-4 w-4" />
                            Bearbeiten
                        </button>
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 text-sm font-medium transition-colors"
                        >
                            <Trash2 className="h-4 w-4" />
                            Löschen
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="glass-effect border-accent/30 rounded-2xl border p-4 shadow-lg">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-primary shadow-lg shadow-accent/25">
                            <FileText className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{useCases.length}</p>
                            <p className="text-xs text-muted">Use Cases zugeordnet</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Use Cases Section */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground px-1">
                    <Layers className="h-5 w-5 text-accent" />
                    Zugeordnete Use Cases
                </h2>

                {useCases.length === 0 ? (
                    <div className="glass-effect border-accent/30 rounded-2xl border border-dashed p-12 text-center">
                        <div className="from-accent/20 to-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
                            <BookOpen className="text-accent h-8 w-8" />
                        </div>
                        <h3 className="text-foreground mb-2 font-semibold">Keine Use Cases gefunden</h3>
                        <p className="text-muted text-sm">
                            Use Cases mit dem Label "{lernfeld.label}" werden hier angezeigt.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {useCases.map((uc) => (
                            <div
                                key={uc.id}
                                onClick={() => router.push(`/trainer/content-management/${uc.courseId}/edit`)}
                                className="group glass-effect relative overflow-hidden rounded-2xl border border-accent/20 p-5 shadow-md transition-all duration-300 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10 cursor-pointer"
                            >
                                {/* Decorative orb */}
                                <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 blur-2xl transition-all duration-500 group-hover:scale-150" />

                                <div className="relative mb-3 flex items-center justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/25">
                                        <BookOpen className="h-5 w-5 text-white" />
                                    </div>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${uc.isActive ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                        {uc.isActive ? 'Aktiv' : 'Entwurf'}
                                    </span>
                                </div>

                                <h3 className="font-semibold text-foreground mb-1 line-clamp-2 group-hover:text-accent transition-colors">
                                    {uc.title}
                                </h3>

                                {uc.descriptionText ? (
                                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{uc.descriptionText}</p>
                                ) : (
                                    <p className="text-xs text-muted-foreground/50 italic mb-3">Keine Beschreibung</p>
                                )}

                                <div className="flex items-center justify-between pt-2 border-t border-accent/10">
                                    <div className="flex items-center gap-1 text-xs text-muted">
                                        <Clock className="h-3.5 w-3.5" />
                                        <span>{uc.durationValue || '–'} {uc.durationUnit || ''}</span>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {showEdit && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-2xl border border-accent/20 bg-card p-6 shadow-2xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-foreground">Lernfeld bearbeiten</h2>
                            <button onClick={() => setShowEdit(false)} className="p-1.5 hover:bg-accent/10 rounded-lg transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Titel *</label>
                                <input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Beschreibung</label>
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                    rows={3}
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-foreground">Lernfeld-Label *</label>
                                <select
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                >
                                    {Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`).map(lbl => (
                                        <option key={lbl} value={lbl}>{lbl}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 pt-3">
                                <button
                                    onClick={() => setShowEdit(false)}
                                    className="rounded-xl border border-accent/20 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/5 transition-colors"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={handleUpdate}
                                    disabled={processing}
                                    className="rounded-xl bg-gradient-to-r from-accent to-primary px-5 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-50 transition-all hover:shadow-xl"
                                >
                                    Speichern
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
