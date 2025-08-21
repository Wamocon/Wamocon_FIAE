'use client';

import { useState } from 'react';
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
  onNavigation: (view: string, data?: any) => void;
}

export function TraineeDetail({ onNavigation }: TraineeDetailProps) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'progress' | 'submissions' | 'notes'
  >('overview');

  // Use mock data from supabase
  const mockTrainee = mockData.trainees[0];
  const mockSubmissions = mockData.quizSubmissions;

  const handleAcceptanceProtocol = () => {
    onNavigation('acceptanceProtocol');
  };

  const tabs = [
    { id: 'overview', label: 'Übersicht', icon: Eye },
    { id: 'progress', label: 'Fortschritt', icon: TrendingUp },
    { id: 'submissions', label: 'Einreichungen', icon: FileCheck2 },
    { id: 'notes', label: 'Notizen', icon: MessageSquare },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="relative">
              <img
                src={mockTrainee.avatar}
                alt={mockTrainee.name}
                className="w-24 h-24 rounded-3xl border-4 border-accent/30 shadow-lg"
              />
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {mockTrainee.name}
              </h1>
              <div className="flex items-center gap-4">
                <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-sm font-medium">
                  Auszubildender
                </span>
                <span className="text-muted">ID: {mockTrainee.id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl transition-all duration-200 flex items-center gap-2">
              <Share2 className="w-4 h-4" />
              Teilen
            </button>
            <button className="px-4 py-2 text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl transition-all duration-200 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </button>
            <button
              onClick={handleAcceptanceProtocol}
              className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2"
            >
              <FileCheck2 className="w-5 h-5" />
              Abnahmeprotokoll
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Gesamtfortschritt</p>
              <p className="text-2xl font-bold text-foreground">
                {mockTrainee.progress}%
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Module abgeschlossen</p>
              <p className="text-2xl font-bold text-foreground">2/4</p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center">
              <Award className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Durchschnitt</p>
              <p className="text-2xl font-bold text-foreground">82%</p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Letzte Aktivität</p>
              <p className="text-2xl font-bold text-foreground">Heute</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-3xl shadow-lg border border-slate-200">
        <div className="border-b border-slate-200">
          <div className="flex overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 bg-blue-50'
                      : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-8">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Aktuelle Lernaktivitäten
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2">
                    Aktuelles Modul
                  </h4>
                  <p className="text-blue-700">Variablen und Datentypen</p>
                  <div className="mt-3 w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: '75%' }}
                    ></div>
                  </div>
                  <p className="text-sm text-blue-600 mt-1">
                    75% abgeschlossen
                  </p>
                </div>

                <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-200">
                  <h4 className="font-semibold text-green-800 mb-2">
                    Nächster Termin
                  </h4>
                  <p className="text-green-700">Reflektion Q3</p>
                  <p className="text-sm text-green-600 mt-1">30.09.2025</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'progress' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Lernfortschritt
              </h3>
              <div className="space-y-4">
                {mockData.curriculum.map(module => (
                  <div
                    key={module.moduleId}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-200"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-800">
                        {module.title}
                      </h4>
                      <span className="text-lg font-bold text-blue-600">
                        {module.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${module.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-sm text-slate-600">
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
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Eingereichte Tests
              </h3>
              <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
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
                          className="hover:bg-white transition-colors duration-200"
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-800">
                              {submission.quizTitle}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-medium ${
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
                              className={`px-3 py-1 rounded-full text-sm font-medium ${
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
                              <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors duration-200">
                                Feedback geben
                              </button>
                            ) : (
                              <button className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors duration-200">
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
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Notizen & Feedback
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2 flex-shrink-0"></div>
                    <div>
                      <p className="text-sm text-yellow-800">
                        <strong>Verbesserungsvorschlag:</strong> Elias könnte
                        mehr praktische Übungen zu Variablen machen.
                      </p>
                      <p className="text-xs text-yellow-600 mt-1">
                        Notiert am 15.01.2025
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-green-50 rounded-2xl border border-green-200">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                    <div>
                      <p className="text-sm text-green-800">
                        <strong>Positives Feedback:</strong> Sehr gute Leistung
                        im Grundbegriffe-Quiz!
                      </p>
                      <p className="text-xs text-green-600 mt-1">
                        Notiert am 12.01.2025
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <button className="px-6 py-3 font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
                Neue Notiz hinzufügen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
