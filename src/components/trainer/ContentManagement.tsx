'use client';

import { useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  BookOpen,
  FolderOpen,
  FileText,
  Eye,
  MoreVertical,
  Search,
  Filter,
} from 'lucide-react';
import { mockData } from '@/lib/supabase';

export function ContentManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Use mock data from supabase
  const mockCurriculum = mockData.curriculum;

  const filteredCurriculum = mockCurriculum.filter(module => {
    const matchesSearch = module.title
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesYear =
      selectedYear === 'all' ||
      module.training_year.toString() === selectedYear;
    return matchesSearch && matchesYear;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Inhalts-Verwaltung
            </h1>
            <p className="text-muted">
              Verwalten Sie Lernmodule, Kapitel und Lektionen
            </p>
          </div>
          <button className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            <Plus className="h-5 w-5" />
            Neues Modul
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
                placeholder="Nach Modulen suchen..."
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-2xl border py-3 pr-4 pl-10 focus:border-transparent focus:ring-2 focus:outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
            >
              <option value="all">Alle Jahre</option>
              <option value="1">Jahr 1</option>
              <option value="2">Jahr 2</option>
              <option value="3">Jahr 3</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="bg-muted/30 flex rounded-2xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                viewMode === 'grid'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCurriculum.map(module => (
            <div
              key={module.moduleId}
              className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-foreground mb-2 text-xl font-bold">
                {module.title}
              </h3>
              <div className="text-muted mb-4 flex items-center gap-2 text-sm">
                <span className="bg-accent rounded-full px-3 py-1 font-medium text-white">
                  Jahr {module.training_year}
                </span>
                <span className="bg-muted/30 text-muted rounded-full px-3 py-1">
                  {module.chapters.length} Kapitel
                </span>
              </div>

              <div className="mb-4 space-y-3">
                {module.chapters.slice(0, 3).map((chapter, index) => (
                  <div
                    key={index}
                    className="bg-muted/30 flex items-center gap-3 rounded-xl p-3"
                  >
                    <FolderOpen className="text-muted h-4 w-4" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-foreground truncate text-sm font-medium">
                        {chapter.title}
                      </h4>
                      <p className="text-muted text-xs">
                        {chapter.lessons.length} Lektionen
                      </p>
                    </div>
                  </div>
                ))}
                {module.chapters.length > 3 && (
                  <div className="text-muted py-2 text-center text-sm">
                    +{module.chapters.length - 3} weitere Kapitel
                  </div>
                )}
              </div>

              <div className="border-accent/30 flex items-center justify-between border-t pt-4">
                <button className="text-accent hover:text-accent/90 text-sm font-medium">
                  Alle Kapitel anzeigen
                </button>
                <button className="text-muted hover:text-foreground text-sm">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCurriculum.map(module => (
            <div
              key={module.moduleId}
              className="glass-effect border-accent/30 rounded-2xl border p-6 shadow-lg"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <BookOpen className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-xl font-bold">
                      {module.title}
                    </h3>
                    <div className="text-muted flex items-center gap-2 text-sm">
                      <span>Jahr {module.training_year}</span>
                      <span>•</span>
                      <span>{module.chapters.length} Kapitel</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {module.chapters.map((chapter, index) => (
                  <div
                    key={index}
                    className="bg-muted/30 border-accent/30 rounded-xl border p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-foreground flex items-center gap-2 font-semibold">
                        <FolderOpen className="text-muted h-4 w-4" />
                        {chapter.title}
                      </h4>
                      <div className="flex items-center gap-1">
                        <button className="text-muted hover:text-accent p-1 transition-colors">
                          <Edit className="h-3 w-3" />
                        </button>
                        <button className="text-muted p-1 transition-colors hover:text-red-600">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-muted flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4" />
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
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-muted to-muted/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="text-muted h-10 w-10" />
          </div>
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            Keine Module gefunden
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all'
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Lernmodul, um zu beginnen.'}
          </p>
          <button className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            Neues Modul erstellen
          </button>
        </div>
      )}
    </div>
  );
}
