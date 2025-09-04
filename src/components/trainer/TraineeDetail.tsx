'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileCheck2,
  TrendingUp,
  Calendar,
  Award,
  BookOpen,
  Eye,
  MessageSquare,
  Download,
  Share2,
  MoreVertical,
} from 'lucide-react';
import { mockData } from '@/lib/supabase';

interface TraineeDetailProps {
  traineeId: string;
}

export default function TraineeDetail({ traineeId }: TraineeDetailProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'progress' | 'submissions' | 'notes'
  >('overview');

  // Use mock data from supabase
  const mockTrainee = mockData.trainees[0];
  const mockSubmissions = mockData.quizSubmissions;

  const handleAcceptanceProtocol = () => {
    router.push('/trainer/acceptance-protocol');
  };

  const tabs = [
    { id: 'overview', label: 'Übersicht', icon: Eye },
    { id: 'progress', label: 'Fortschritt', icon: TrendingUp },
    { id: 'submissions', label: 'Einreichungen', icon: FileCheck2 },
    { id: 'notes', label: 'Notizen', icon: MessageSquare },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <div className="relative">
              <img
                src={mockTrainee.avatar}
                alt={mockTrainee.name}
                className="border-accent/30 h-24 w-24 rounded-3xl border-4 shadow-lg"
              />
              <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-500">
                <div className="h-3 w-3 rounded-full bg-white"></div>
              </div>
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {mockTrainee.name}
              </h1>
              <div className="flex items-center gap-4">
                <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                  Auszubildender
                </span>
                <span className="text-muted">ID: {mockTrainee.id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200">
              <Share2 className="h-4 w-4" />
              Teilen
            </button>
            <button className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200">
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={handleAcceptanceProtocol}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              <FileCheck2 className="h-5 w-5" />
              Abnahmeprotokoll
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Gesamtfortschritt</p>
              <p className="text-foreground text-2xl font-bold">
                {mockTrainee.progress}%
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Module abgeschlossen</p>
              <p className="text-foreground text-2xl font-bold">2/4</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-violet-500">
              <Award className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Durchschnitt</p>
              <p className="text-foreground text-2xl font-bold">82%</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Letzte Aktivität</p>
              <p className="text-foreground text-2xl font-bold">Heute</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-200">
          <div className="flex overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-8">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Aktuelle Lernaktivitäten
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
                  <h4 className="mb-2 font-semibold text-blue-800">
                    Aktuelles Modul
                  </h4>
                  <p className="text-blue-700">Variablen und Datentypen</p>
                  <div className="mt-3 h-2 w-full rounded-full bg-blue-200">
                    <div
                      className="h-2 rounded-full bg-blue-600"
                      style={{ width: '75%' }}
                    ></div>
                  </div>
                  <p className="mt-1 text-sm text-blue-600">
                    75% abgeschlossen
                  </p>
                </div>

                <div className="rounded-2xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6">
                  <h4 className="mb-2 font-semibold text-green-800">
                    Nächster Termin
                  </h4>
                  <p className="text-green-700">Reflektion Q3</p>
                  <p className="mt-1 text-sm text-green-600">30.09.2025</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'progress' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Lernfortschritt
              </h3>
              <div className="space-y-4">
                {mockData.curriculum.map(module => (
                  <div
                    key={module.moduleId}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="font-semibold text-slate-800">
                        {module.title}
                      </h4>
                      <span className="text-lg font-bold text-blue-600">
                        {module.progress}%
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-200">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                        style={{ width: `${module.progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                      <span>Jahr {module.training_year}</span>
                      <span>{module.chapters?.length || 0} Kapitel</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'submissions' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Eingereichte Tests
              </h3>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">
                          Quiz Titel
                        </th>
                        <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">
                          Ergebnis
                        </th>
                        <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">
                          Status
                        </th>
                        <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">
                          Datum
                        </th>
                        <th className="px-6 py-4 text-left text-sm font-medium text-slate-700">
                          Aktion
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {mockSubmissions.map(submission => (
                        <tr
                          key={submission.submissionId}
                          className="transition-colors duration-200 hover:bg-white"
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-800">
                              {submission.quizTitle}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-sm font-medium ${
                                submission.score >= 80
                                  ? 'bg-green-100 text-green-700'
                                  : submission.score >= 60
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {submission.score}%
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-sm font-medium ${
                                submission.status === 'reviewed'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}
                            >
                              {submission.status === 'reviewed'
                                ? 'Bewertet'
                                : 'Ausstehend'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {new Date(
                              submission.submitted_at
                            ).toLocaleDateString('de-DE')}
                          </td>
                          <td className="px-6 py-4">
                            {submission.status === 'submitted' ? (
                              <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-blue-700">
                                Feedback geben
                              </button>
                            ) : (
                              <button className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-200">
                                Anzeigen
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Notizen & Feedback
              </h3>
              <div className="space-y-4">
                <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-yellow-500"></div>
                    <div>
                      <p className="text-sm text-yellow-800">
                        <strong>Verbesserungsvorschlag:</strong> Elias könnte
                        mehr praktische Übungen zu Variablen machen.
                      </p>
                      <p className="mt-1 text-xs text-yellow-600">
                        Notiert am 15.01.2025
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-green-500"></div>
                    <div>
                      <p className="text-sm text-green-800">
                        <strong>Positives Feedback:</strong> Sehr gute Leistung
                        im Grundbegriffe-Quiz!
                      </p>
                      <p className="mt-1 text-xs text-green-600">
                        Notiert am 12.01.2025
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <button className="transform rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl">
                Neue Notiz hinzufügen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
