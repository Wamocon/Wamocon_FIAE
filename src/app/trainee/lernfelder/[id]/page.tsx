'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock, Layers, ArrowRight, FileText, PlayCircle } from 'lucide-react';

export default function TraineeLernfeldDetailPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const id = params?.id as string;
    const [data, setData] = useState<{ lernfeld: any; useCases: any[] } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (id) {
            fetch(`/api/trainee/lernfelder/${id}`)
                .then(res => res.json())
                .then(d => {
                    setData(d);
                    setLoading(false);
                })
                .catch(err => {
                    console.error(err);
                    setLoading(false);
                });
        }
    }, [id]);

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
                            <p className="text-xs text-muted">Aufgaben verfügbar</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Use Cases Section */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground px-1">
                    <Layers className="h-5 w-5 text-accent" />
                    Deine Aufgaben
                </h2>

                {useCases.length === 0 ? (
                    <div className="glass-effect border-accent/30 rounded-2xl border border-dashed p-12 text-center">
                        <div className="from-accent/20 to-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
                            <BookOpen className="text-accent h-8 w-8" />
                        </div>
                        <h3 className="text-foreground mb-2 font-semibold">Keine Aufgaben verfügbar</h3>
                        <p className="text-muted text-sm">
                            In diesem Lernfeld wurden noch keine Aufgaben für dich freigeschaltet.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {useCases.map((uc) => (
                            <div
                                key={uc.id}
                                onClick={() => router.push(`/trainee/use-cases/${uc.id}`)}
                                className="group glass-effect relative overflow-hidden rounded-2xl border border-accent/20 p-5 shadow-md transition-all duration-300 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10 cursor-pointer"
                            >
                                {/* Decorative orb */}
                                <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 blur-2xl transition-all duration-500 group-hover:scale-150" />

                                <div className="relative mb-3 flex items-center justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/25">
                                        <BookOpen className="h-5 w-5 text-white" />
                                    </div>
                                    <PlayCircle className="h-5 w-5 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
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
                                    <span className="text-accent text-xs font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        Starten
                                        <ArrowRight className="h-3 w-3" />
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
