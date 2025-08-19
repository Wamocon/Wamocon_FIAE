'use client'

import { useState } from 'react'
import { Plus, Edit, Trash2, FileQuestion, Clock, Target, Users, BarChart3, Search, Filter, Eye, Copy, MoreVertical } from 'lucide-react'

export function QuizManagement() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  
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
      lastUsed: '2025-01-15'
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
      lastUsed: '2025-01-12'
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
      lastUsed: null
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
      lastUsed: '2024-12-20'
    }
  ]

  const filteredQuizzes = mockQuizzes.filter(quiz => {
    const matchesSearch = quiz.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         quiz.description.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = selectedStatus === 'all' || quiz.status === selectedStatus
    return matchesSearch && matchesStatus
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30'
      case 'draft': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      case 'archived': return 'bg-muted/30 text-muted border-accent/30'
      default: return 'bg-muted/30 text-muted border-accent/30'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Aktiv'
      case 'draft': return 'Entwurf'
      case 'archived': return 'Archiviert'
      default: return 'Unbekannt'
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Quiz-Verwaltung</h1>
            <p className="text-muted">Erstellen und verwalten Sie Tests und Quizze für Ihre Auszubildenden</p>
          </div>
          <button className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Neues Quiz
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                placeholder="Nach Quizzen suchen..."
                className="w-full pl-10 pr-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground"
            >
              <option value="all">Alle Status</option>
              <option value="active">Aktiv</option>
              <option value="draft">Entwurf</option>
              <option value="archived">Archiviert</option>
            </select>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-muted">
            <span>{filteredQuizzes.length} Quizze gefunden</span>
          </div>
        </div>
      </div>

      {/* Quiz Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredQuizzes.map((quiz) => (
          <div key={quiz.id} className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30 hover:shadow-xl transition-all duration-300">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                <FileQuestion className="w-6 h-6 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 text-muted hover:text-accent hover:bg-accent/10 rounded-xl transition-all duration-200">
                  <Eye className="w-4 h-4" />
                </button>
                <button className="p-2 text-muted hover:text-accent hover:bg-accent/10 rounded-xl transition-all duration-200">
                  <Edit className="w-4 h-4" />
                </button>
                <button className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all duration-200">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <h3 className="font-bold text-xl text-foreground mb-2">{quiz.title}</h3>
            <p className="text-muted text-sm mb-4 line-clamp-2">{quiz.description}</p>
            
            {/* Status Badge */}
            <div className="mb-4">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(quiz.status)}`}>
                {getStatusLabel(quiz.status)}
              </span>
            </div>
            
            {/* Quiz Details */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center text-muted">
                  <Clock className="w-4 h-4 mr-2" />
                  Zeitlimit
                </div>
                <span className="font-medium text-foreground">{quiz.timeLimit} Min.</span>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center text-muted">
                  <Target className="w-4 h-4 mr-2" />
                  Bestehensgrenze
                </div>
                <span className="font-medium text-foreground">{quiz.passingScore}%</span>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Fragen</span>
                <span className="font-medium text-foreground">{quiz.questionCount}</span>
              </div>
            </div>
            
            {/* Stats */}
            {quiz.status === 'active' && (
              <div className="pt-4 border-t border-accent/30 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-muted">
                    <Users className="w-4 h-4 mr-2" />
                    Versuche
                  </div>
                  <span className="font-medium text-foreground">{quiz.attempts}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-muted">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Ø Punktzahl
                  </div>
                  <span className="font-medium text-foreground">{quiz.avgScore}%</span>
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-accent/30">
              <button className="text-sm text-accent hover:text-accent/90 font-medium">
                Ergebnisse anzeigen
              </button>
              <button className="text-sm text-muted hover:text-foreground">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredQuizzes.length === 0 && (
        <div className="glass-effect rounded-3xl p-12 shadow-lg border border-accent/30 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-muted to-muted/30 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <FileQuestion className="w-10 h-10 text-muted" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">Keine Quizze gefunden</h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedStatus !== 'all' 
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Quiz, um zu beginnen.'
            }
          </p>
          <button className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
            Neues Quiz erstellen
          </button>
        </div>
      )}
    </div>
  )
}
