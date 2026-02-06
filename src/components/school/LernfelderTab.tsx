'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layers, Search, BookOpen, ArrowRight } from 'lucide-react';

export function LernfelderTab() {
    const router = useRouter();
    const { t } = useLanguage();
    const [lernfelder, setLernfelder] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetch('/api/trainee/lernfelder')
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

    const filteredLernfelder = useMemo(() => {
        if (!searchTerm) return lernfelder;
        return lernfelder.filter(lf =>
            lf.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            lf.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [lernfelder, searchTerm]);

    if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="border-accent/30 border-t-accent h-8 w-8 animate-spin rounded-full border-4"></div></div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
                <div>
                    <h2 className="text-foreground text-2xl font-bold">{t('lernfelder.title')}</h2>
                    <p className="text-muted text-sm">{t('lernfelder.description')}</p>
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
                {filteredLernfelder.map((lf) => (
                    <div
                        key={lf.id}
                        onClick={() => router.push(`/trainee/lernfelder/${lf.id}`)}
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
                                    {t('lernfelder.noDescription')}
                                </p>
                            )}
                        </div>

                        {/* Stats Row */}
                        <div className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2 mt-auto">
                            <div className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-accent" />
                                <span className="text-foreground text-sm font-medium">{t('lernfelder.useCases')}</span>
                            </div>
                            <span className="text-accent font-bold">{lf.useCaseCount || 0}</span>
                        </div>

                        {/* Hover indicator */}
                        <div className="mt-3 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-accent text-xs font-medium flex items-center gap-1">
                                {t('lernfelder.viewTasks')}
                                <ArrowRight className="h-3 w-3" />
                            </span>
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
                    <h3 className="text-foreground mb-2 text-lg font-semibold">{t('lernfelder.notFound')}</h3>
                    <p className="text-muted text-sm">
                        {searchTerm ? t('lernfelder.tryDifferentSearch') : t('lernfelder.noneAssigned')}
                    </p>
                </div>
            )}
        </div>
    );
}
