'use client';

import { useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  FileQuestion,
  Clock,
  Target,
  Users,
  BarChart3,
  Search,
  Filter,
  Eye,
  Copy,
  MoreVertical,
} from 'lucide-react';

export function QuizManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');

  // Mock quiz data
  const mockQuizzes = [
    {
      id: 'quiz_1',
      title: 'Grundbegriffe der Programmierung',
      description: 'Test über die Grundlagen der Programmierung',
      timeLimit: 30,
      passingScore: 70,
      questionCount: 15,
      status: 'active',
      attempts: 24,
      avgScore: 78,
      lastUsed: '2025-01-15',
    },
    {
      id: 'quiz_2',
      title: 'Variablen und Datentypen',
      description: 'Quiz über Variablen, Datentypen und Operatoren',
      timeLimit: 25,
      passingScore: 75,
      questionCount: 12,
      status: 'active',
      attempts: 18,
      avgScore: 82,
      lastUsed: '2025-01-12',
    },
    {
      id: 'quiz_3',
      title: 'Abschlusstest: Einführung in die Programmierung',
      description: 'Umfassender Test über das erste Modul',
      timeLimit: 45,
      passingScore: 80,
      questionCount: 20,
      status: 'draft',
      attempts: 0,
      avgScore: 0,
      lastUsed: null,
    },
    {
      id: 'quiz_4',
      title: 'Datenbank-Grundlagen',
      description: 'Test über relationale Datenbanken und SQL',
      timeLimit: 35,
      passingScore: 75,
      questionCount: 18,
      status: 'archived',
      attempts: 45,
      avgScore: 76,
      lastUsed: '2024-12-20',
    },
  ];

  const filteredQuizzes = mockQuizzes.filter(quiz => {
    const matchesSearch =
      quiz.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      quiz.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      selectedStatus === 'all' || quiz.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'draft':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'archived':
        return 'bg-muted/30 text-muted border-accent/30';
      default:
        return 'bg-muted/30 text-muted border-accent/30';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Aktiv';
      case 'draft':
        return 'Entwurf';
      case 'archived':
        return 'Archiviert';
      default:
        return 'Unbekannt';
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Quiz-Verwaltung
            </h1>
            <p className="text-muted">
              Erstellen und verwalten Sie Tests und Quizze für Ihre
              Auszubildenden
            </p>
          </div>
          <button className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            <Plus className="h-5 w-5" />
            Neues Quiz
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
          {/* Search and Filters */}
          <div className="flex flex-1 flex-col gap-4 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <Search className="text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Nach Quizzen suchen..."
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-2xl border py-3 pr-4 pl-10 focus:border-transparent focus:ring-2 focus:outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
            >
              <option value="all">Alle Status</option>
              <option value="active">Aktiv</option>
              <option value="draft">Entwurf</option>
              <option value="archived">Archiviert</option>
            </select>
          </div>

          {/* Stats */}
          <div className="text-muted flex items-center gap-4 text-sm">
            <span>{filteredQuizzes.length} Quizze gefunden</span>
          </div>
        </div>
      </div>

      {/* Quiz Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredQuizzes.map(quiz => (
          <div
            key={quiz.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                <FileQuestion className="h-6 w-6 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <button className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200">
                  <Eye className="h-4 w-4" />
                </button>
                <button className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200">
                  <Edit className="h-4 w-4" />
                </button>
                <button className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-500/10 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <h3 className="text-foreground mb-2 text-xl font-bold">
              {quiz.title}
            </h3>
            <p className="text-muted mb-4 line-clamp-2 text-sm">
              {quiz.description}
            </p>

            {/* Status Badge */}
            <div className="mb-4">
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${getStatusColor(quiz.status)}`}
              >
                {getStatusLabel(quiz.status)}
              </span>
            </div>

            {/* Quiz Details */}
            <div className="mb-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="text-muted flex items-center">
                  <Clock className="mr-2 h-4 w-4" />
                  Zeitlimit
                </div>
                <span className="text-foreground font-medium">
                  {quiz.timeLimit} Min.
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <div className="text-muted flex items-center">
                  <Target className="mr-2 h-4 w-4" />
                  Bestehensgrenze
                </div>
                <span className="text-foreground font-medium">
                  {quiz.passingScore}%
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Fragen</span>
                <span className="text-foreground font-medium">
                  {quiz.questionCount}
                </span>
              </div>
            </div>

            {/* Stats */}
            {quiz.status === 'active' && (
              <div className="border-accent/30 space-y-3 border-t pt-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted flex items-center">
                    <Users className="mr-2 h-4 w-4" />
                    Versuche
                  </div>
                  <span className="text-foreground font-medium">
                    {quiz.attempts}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted flex items-center">
                    <BarChart3 className="mr-2 h-4 w-4" />Ø Punktzahl
                  </div>
                  <span className="text-foreground font-medium">
                    {quiz.avgScore}%
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="border-accent/30 flex items-center justify-between border-t pt-4">
              <button className="text-accent hover:text-accent/90 text-sm font-medium">
                Ergebnisse anzeigen
              </button>
              <button className="text-muted hover:text-foreground text-sm">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredQuizzes.length === 0 && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-muted to-muted/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <FileQuestion className="text-muted h-10 w-10" />
          </div>
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            Keine Quizze gefunden
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedStatus !== 'all'
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Quiz, um zu beginnen.'}
          </p>
          <button className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            Neues Quiz erstellen
          </button>
        </div>
      )}
    </div>
  );
}
