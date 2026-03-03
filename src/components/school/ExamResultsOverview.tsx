'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
          `/api/trainee/school/exams?traineeId=${profile.id}&upcoming=false`,
          { cache: 'no-store' }
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

    const averageGrade =
      gradesNumbers.length > 0
        ? (
            gradesNumbers.reduce((a, b) => a + b, 0) / gradesNumbers.length
          ).toFixed(1)
        : null;

    const pointsValues = results
      .filter(r => r.points !== null)
      .map(r => r.points!);

    const averagePoints =
      pointsValues.length > 0
        ? Math.round(
            pointsValues.reduce((a, b) => a + b, 0) / pointsValues.length
          )
        : null;

    const bySubject: Record<
      string,
      { total: number; passed: number; avgGrade: string | null }
    > = {};
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
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-foreground text-xl font-bold">
          {t('exams.results.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {stats.total} {t('exams.results.examResults')}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="glass-effect rounded-2xl py-12 text-center">
          <GraduationCap className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <p className="text-muted-foreground">
            {t('exams.results.noResultsYet')}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('exams.results.noResults')}
          </p>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="glass-effect rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t('exams.results.total')}
                  </p>
                  <p className="text-foreground text-2xl font-bold">
                    {stats.total}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-effect rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/20 p-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t('exams.results.passed')}
                  </p>
                  <p className="text-foreground text-2xl font-bold">
                    {stats.passed}
                    <span className="text-muted-foreground ml-1 text-sm">
                      ({stats.passRate}%)
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-effect rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-500/20 p-2">
                  <GraduationCap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t('exams.results.averageGrade')}
                  </p>
                  <p className="text-foreground text-2xl font-bold">
                    {stats.averageGrade || '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-effect rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-lg p-2 ${stats.failed > 0 ? 'bg-destructive/20' : 'bg-green-500/20'}`}
                >
                  {stats.failed > 0 ? (
                    <XCircle className="text-destructive h-5 w-5" />
                  ) : (
                    <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t('exams.results.failed')}
                  </p>
                  <p className="text-foreground text-2xl font-bold">
                    {stats.failed}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Subject Breakdown */}
          {Object.keys(stats.bySubject).length > 0 && (
            <div className="glass-effect rounded-xl p-4">
              <h3 className="text-foreground mb-4 flex items-center gap-2 font-semibold">
                <BookOpen className="text-accent h-4 w-4" />
                {t('exams.results.bySubject')}
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {Object.entries(stats.bySubject).map(([subject, data]) => (
                  <div
                    key={subject}
                    className="bg-card border-border rounded-lg border p-3"
                  >
                    <p className="text-foreground text-sm font-medium">
                      {subject}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {data.total} {t('exams.results.exams')}
                      </span>
                      <span
                        className={`text-xs ${
                          data.passed === data.total
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {Math.round((data.passed / data.total) * 100)}%{' '}
                        {t('exams.results.passedLower')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results Table */}
          <div className="glass-effect overflow-x-auto rounded-xl">
            <table className="w-full">
              <thead>
                <tr className="border-border border-b">
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium">
                    {t('exams.results.date')}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium">
                    {t('exams.results.subject')}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium">
                    {t('exams.results.grade')}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium">
                    {t('common.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map(result => (
                  <tr
                    key={result.id}
                    className="border-border/50 hover:bg-muted/30 border-b transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-foreground text-sm">
                        {new Date(result.exam.examDate).toLocaleDateString(
                          'de-DE'
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-foreground text-sm">
                        {result.exam.subject}
                      </span>
                      {result.exam.lernfeldCode && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({result.exam.lernfeldCode})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-foreground text-sm font-bold">
                        {result.grade ||
                          (result.points !== null
                            ? `${result.points} ${t('exams.results.points')}`
                            : '—')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {result.passed !== null && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            result.passed
                              ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                              : 'bg-destructive/20 text-destructive'
                          } `}
                        >
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
