'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock, Layers } from 'lucide-react';

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

    if (loading) return <div className="p-8">Laden...</div>;
    if (!data || !data.lernfeld) return <div className="p-8">Lernfeld nicht gefunden</div>;

    const { lernfeld, useCases } = data;

    return (
        <div className="min-h-screen bg-background p-6 space-y-6">
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

            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Aufgaben ({useCases.length})
                </h2>

                {useCases.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-accent/30 p-8 text-center text-muted-foreground">
                        Keine Aufgaben in diesem Lernfeld verfügbar.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {useCases.map((uc) => (
                            <div
                                key={uc.id}
                                onClick={() => router.push(`/trainee/use-cases/${uc.id}`)}
                                className="group relative cursor-pointer overflow-hidden rounded-2xl border border-accent/20 bg-card p-5 transition-all hover:border-accent/40 hover:shadow-md"
                            >
                                <div className="mb-2 flex items-start justify-between">
                                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                        <BookOpen className="h-5 w-5" />
                                    </div>
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
        </div>
    );
}
