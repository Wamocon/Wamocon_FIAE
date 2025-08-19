'use client'

import { useState } from 'react'
import { Plus, Edit, Trash2, BookOpen, FolderOpen, FileText, Eye, MoreVertical, Search, Filter } from 'lucide-react'
import { mockData } from '@/lib/supabase'

export function ContentManagement() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  
  // Use mock data from supabase
  const mockCurriculum = mockData.curriculum

  const filteredCurriculum = mockCurriculum.filter(module => {
    const matchesSearch = module.title.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesYear = selectedYear === 'all' || module.training_year.toString() === selectedYear
    return matchesSearch && matchesYear
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Inhalts-Verwaltung</h1>
            <p className="text-muted">Verwalten Sie Lernmodule, Kapitel und Lektionen</p>
          </div>
          <button className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Neues Modul
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
                placeholder="Nach Modulen suchen..."
                className="w-full pl-10 pr-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground"
            >
              <option value="all">Alle Jahre</option>
              <option value="1">Jahr 1</option>
              <option value="2">Jahr 2</option>
              <option value="3">Jahr 3</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex bg-muted/30 rounded-2xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                viewMode === 'grid'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Liste
            </button>
          </div>
        </div>
      </div>

      {/* Content Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCurriculum.map((module) => (
            <div key={module.moduleId} className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30 hover:shadow-xl transition-all duration-300">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <button className="p-2 text-muted hover:text-accent hover:bg-accent/10 rounded-xl transition-all duration-200">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button className="p-2 text-muted hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <h3 className="font-bold text-xl text-foreground mb-2">{module.title}</h3>
              <div className="flex items-center gap-2 text-sm text-muted mb-4">
                <span className="px-3 py-1 bg-accent text-white rounded-full font-medium">
                  Jahr {module.training_year}
                </span>
                <span className="px-3 py-1 bg-muted/30 text-muted rounded-full">
                  {module.chapters.length} Kapitel
                </span>
              </div>
              
              <div className="space-y-3 mb-4">
                {module.chapters.slice(0, 3).map((chapter, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                    <FolderOpen className="w-4 h-4 text-muted" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-foreground text-sm truncate">{chapter.title}</h4>
                      <p className="text-xs text-muted">{chapter.lessons.length} Lektionen</p>
                    </div>
                  </div>
                ))}
                {module.chapters.length > 3 && (
                  <div className="text-center text-sm text-muted py-2">
                    +{module.chapters.length - 3} weitere Kapitel
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-accent/30">
                <button className="text-sm text-accent hover:text-accent/90 font-medium">
                  Alle Kapitel anzeigen
                </button>
                <button className="text-sm text-muted hover:text-foreground">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCurriculum.map((module) => (
            <div key={module.moduleId} className="glass-effect rounded-2xl p-6 shadow-lg border border-accent/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-foreground">{module.title}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>Jahr {module.training_year}</span>
                      <span>•</span>
                      <span>{module.chapters.length} Kapitel</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button className="p-2 text-muted hover:text-accent hover:bg-accent/10 rounded-xl transition-all duration-200">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button className="p-2 text-muted hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {module.chapters.map((chapter, index) => (
                  <div key={index} className="p-4 bg-muted/30 rounded-xl border border-accent/30">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-foreground flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-muted" />
                        {chapter.title}
                      </h4>
                      <div className="flex items-center gap-1">
                        <button className="p-1 text-muted hover:text-accent transition-colors">
                          <Edit className="w-3 h-3" />
                        </button>
                        <button className="p-1 text-muted hover:text-red-600 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <FileText className="w-4 h-4" />
                      <span>{chapter.lessons.length} Lektionen</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredCurriculum.length === 0 && (
        <div className="glass-effect rounded-3xl p-12 shadow-lg border border-accent/30 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-muted to-muted/30 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-10 h-10 text-muted" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">Keine Module gefunden</h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all' 
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Lernmodul, um zu beginnen.'
            }
          </p>
          <button className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
            Neues Modul erstellen
          </button>
        </div>
      )}
    </div>
  )
}
