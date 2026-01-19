'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock, Layers, Edit2, Trash2, X } from 'lucide-react';

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
                fetchLernfeld(); // Refresh data
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

    if (loading) return <div className="p-8">Laden...</div>;
    if (!data || !data.lernfeld) return <div className="p-8">Lernfeld nicht gefunden</div>;

    const { lernfeld, useCases } = data;

    return (
        <div className="min-h-screen bg-background p-6 space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.back()} className="rounded-full p-2 hover:bg-accent/10">
                        <ArrowLeft className="h-6 w-6" />
                    </button>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                                {lernfeld.label}
                            </span>
                            <h1 className="text-2xl font-bold">{lernfeld.title}</h1>
                        </div>
                        <p className="text-muted-foreground">{lernfeld.description}</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleEditOpen}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/20 hover:bg-accent/10 text-sm font-medium transition-colors"
                    >
                        <Edit2 className="h-4 w-4" />
                        Bearbeiten
                    </button>
                    <button
                        onClick={handleDelete}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 hover:bg-red-500/10 text-red-500 text-sm font-medium transition-colors"
                    >
                        <Trash2 className="h-4 w-4" />
                        Löschen
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Zugeordnete Use Cases ({useCases.length})
                </h2>

                {useCases.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-accent/30 p-8 text-center text-muted-foreground">
                        Keine Use Cases für dieses Lernfeld ({lernfeld.label}) gefunden.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {useCases.map((uc) => (
                            <div
                                key={uc.id}
                                onClick={() => router.push(`/trainer/content-management/${uc.courseId}/edit`)}
                                className="group relative cursor-pointer overflow-hidden rounded-2xl border border-accent/20 bg-card p-5 transition-all hover:border-accent/40 hover:shadow-md"
                            >
                                <div className="mb-2 flex items-start justify-between">
                                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                        <BookOpen className="h-5 w-5" />
                                    </div>
                                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${uc.isActive ? 'border-green-500/20 bg-green-500/10 text-green-600' : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-600'}`}>
                                        {uc.isActive ? 'Aktiv' : 'Entwurf'}
                                    </span>
                                </div>
                                <h3 className="mb-1 font-semibold group-hover:text-primary">{uc.title}</h3>
                                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{uc.descriptionText}</p>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-3.5 w-3.5" />
                                        <span>{uc.durationValue} {uc.durationUnit}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {showEdit && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
                    <div className="glass-effect w-full max-w-md rounded-3xl border border-accent/20 bg-background p-6 shadow-2xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Lernfeld bearbeiten</h2>
                            <button onClick={() => setShowEdit(false)} className="p-1 hover:bg-accent/10 rounded-full">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium">Titel</label>
                                <input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background/50 px-3 py-2"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium">Beschreibung</label>
                                <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background/50 px-3 py-2"
                                    rows={3}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium">Lernfeld-Label</label>
                                <select
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                    className="w-full rounded-xl border border-accent/20 bg-background/50 px-3 py-2"
                                >
                                    {Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`).map(lbl => (
                                        <option key={lbl} value={lbl}>{lbl}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setShowEdit(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-accent/10 border border-transparent hover:border-accent/10">Abbrechen</button>
                                <button onClick={handleUpdate} disabled={processing} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Speichern</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
