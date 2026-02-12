'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    GraduationCap,
    TrendingUp,
    CheckCircle,
    XCircle,
    BarChart3,
    BookOpen,
} from 'lucide-react';

interface ExamResult {
    id: string;
    exam: {
        id: string;
        examDate: string;
        subject: string;
        examTypeValue: string | null;
        lernfeldCode: string | null;
    };
    grade: string | null;
    points: number | null;
    percentage: number | null;
    passed: boolean | null;
    recordedAt: string;
}

export function ExamResultsOverview() {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const [results, setResults] = useState<ExamResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!profile?.id) return;

        const loadResults = async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    `/api/trainee/school/exams?traineeId=${profile.id}&upcoming=false`
                );
                if (!res.ok) throw new Error(t('exams.results.loading'));
                const data = await res.json();

                const withResults = (data.exams || [])
                    .filter((e: any) => e.result)
                    .map((e: any) => ({
                        id: e.result.id,
                        exam: {
                            id: e.id,
                            examDate: e.examDate,
                            subject: e.subject,
                            examTypeValue: e.examTypeValue,
                            lernfeldCode: e.lernfeldCode,
                        },
                        ...e.result,
                    }));

                setResults(withResults);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        loadResults();
    }, [profile?.id]);

    const stats = useMemo(() => {
        if (results.length === 0) {
            return {
                total: 0,
                passed: 0,
                failed: 0,
                passRate: 0,
                averageGrade: null,
                averagePoints: null,
                bySubject: {},
            };
        }

        const passed = results.filter(r => r.passed).length;
        const failed = results.length - passed;

        const gradesNumbers = results
            .filter(r => r.grade)
            .map(r => parseFloat(r.grade!.replace(/[+-]/g, '')))
            .filter(n => !isNaN(n));

        const averageGrade = gradesNumbers.length > 0
            ? (gradesNumbers.reduce((a, b) => a + b, 0) / gradesNumbers.length).toFixed(1)
            : null;

        const pointsValues = results
            .filter(r => r.points !== null)
            .map(r => r.points!);

        const averagePoints = pointsValues.length > 0
            ? Math.round(pointsValues.reduce((a, b) => a + b, 0) / pointsValues.length)
            : null;

        const bySubject: Record<string, { total: number; passed: number; avgGrade: string | null }> = {};
        results.forEach(r => {
            const subj = r.exam.lernfeldCode || r.exam.subject;
            if (!bySubject[subj]) {
                bySubject[subj] = { total: 0, passed: 0, avgGrade: null };
            }
            bySubject[subj].total++;
            if (r.passed) bySubject[subj].passed++;
        });

        return {
            total: results.length,
            passed,
            failed,
            passRate: Math.round((passed / results.length) * 100),
            averageGrade,
            averagePoints,
            bySubject,
        };
    }, [results]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-xl font-bold text-foreground">{t('exams.results.title')}</h2>
                <p className="text-sm text-muted-foreground">
                    {stats.total} {t('exams.results.examResults')}
                </p>
            </div>

            {results.length === 0 ? (
                <div className="text-center py-12 glass-effect rounded-2xl">
                    <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t('exams.results.noResultsYet')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('exams.results.noResults')}
                    </p>
                </div>
            ) : (
                <>
                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl glass-effect">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-500/20">
                                    <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('exams.results.total')}</p>
                                    <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl glass-effect">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/20">
                                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('exams.results.passed')}</p>
                                    <p className="text-2xl font-bold text-foreground">
                                        {stats.passed}
                                        <span className="text-sm text-muted-foreground ml-1">({stats.passRate}%)</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl glass-effect">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-amber-500/20">
                                    <GraduationCap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('exams.results.averageGrade')}</p>
                                    <p className="text-2xl font-bold text-foreground">
                                        {stats.averageGrade || '—'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl glass-effect">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${stats.failed > 0 ? 'bg-destructive/20' : 'bg-green-500/20'}`}>
                                    {stats.failed > 0 ? (
                                        <XCircle className="h-5 w-5 text-destructive" />
                                    ) : (
                                        <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('exams.results.failed')}</p>
                                    <p className="text-2xl font-bold text-foreground">{stats.failed}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Subject Breakdown */}
                    {Object.keys(stats.bySubject).length > 0 && (
                        <div className="p-4 rounded-xl glass-effect">
                            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-accent" />
                                {t('exams.results.bySubject')}
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(stats.bySubject).map(([subject, data]) => (
                                    <div
                                        key={subject}
                                        className="p-3 rounded-lg bg-card border border-border"
                                    >
                                        <p className="font-medium text-foreground text-sm">{subject}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-muted-foreground">{data.total} {t('exams.results.exams')}</span>
                                            <span className={`text-xs ${data.passed === data.total
                                                    ? 'text-green-600 dark:text-green-400'
                                                    : 'text-amber-600 dark:text-amber-400'
                                                }`}>
                                                {Math.round((data.passed / data.total) * 100)}% {t('exams.results.passedLower')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Results Table */}
                    <div className="overflow-x-auto glass-effect rounded-xl">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left text-xs text-muted-foreground font-medium py-3 px-4">{t('exams.results.date')}</th>
                                    <th className="text-left text-xs text-muted-foreground font-medium py-3 px-4">{t('exams.results.subject')}</th>
                                    <th className="text-left text-xs text-muted-foreground font-medium py-3 px-4">{t('exams.results.grade')}</th>
                                    <th className="text-left text-xs text-muted-foreground font-medium py-3 px-4">{t('common.status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((result) => (
                                    <tr
                                        key={result.id}
                                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                                    >
                                        <td className="py-3 px-4">
                                            <span className="text-sm text-foreground">
                                                {new Date(result.exam.examDate).toLocaleDateString('de-DE')}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className="text-sm text-foreground">{result.exam.subject}</span>
                                            {result.exam.lernfeldCode && (
                                                <span className="ml-2 text-xs text-muted-foreground">({result.exam.lernfeldCode})</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className="text-sm font-bold text-foreground">
                                                {result.grade || (result.points !== null ? `${result.points} ${t('exams.results.points')}` : '—')}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            {result.passed !== null && (
                                                <span className={`
                                                    inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                                                    ${result.passed
                                                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                                        : 'bg-destructive/20 text-destructive'
                                                    }
                                                `}>
                                                    {result.passed ? (
                                                        <>
                                                            <CheckCircle className="h-3 w-3" />
                                                            {t('exams.results.passed')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <XCircle className="h-3 w-3" />
                                                            {t('exams.results.failed')}
                                                        </>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
