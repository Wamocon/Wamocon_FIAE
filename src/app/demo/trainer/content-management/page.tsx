'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { demoContentItems } from '@/components/demo/data/demoContentManagement';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Search,
  Plus,
  BookOpen,
  HelpCircle,
  Edit,
  MoreVertical,
  CheckCircle,
  FileEdit,
  Archive,
} from 'lucide-react';
import { useState, useMemo } from 'react';

export default function DemoTrainerContentManagement() {
  const { showDemoToast } = useDemo();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'archived'>('all');

  const filteredItems = useMemo(() => {
    let items = demoContentItems;
    if (filter !== 'all') {
      items = items.filter(i => i.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        i =>
          i.title.toLowerCase().includes(q) ||
          i.component.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q)
      );
    }
    return items;
  }, [search, filter]);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return (
          <Badge className="bg-green-500/20 text-green-400">
            <CheckCircle className="mr-1 h-3 w-3" />
            Veröffentlicht
          </Badge>
        );
      case 'draft':
        return (
          <Badge className="bg-amber-500/20 text-amber-400">
            <FileEdit className="mr-1 h-3 w-3" />
            Entwurf
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Archive className="mr-1 h-3 w-3" />
            Archiviert
          </Badge>
        );
    }
  };

  const totals = {
    published: demoContentItems.filter(i => i.status === 'published').length,
    draft: demoContentItems.filter(i => i.status === 'draft').length,
    archived: demoContentItems.filter(i => i.status === 'archived').length,
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Inhaltsverwaltung</h1>
          <p className="text-muted-foreground mt-1">
            {demoContentItems.length} Kurse &middot;{' '}
            {demoContentItems.reduce((s, i) => s + i.enablerCount, 0)} Enabler &middot;{' '}
            {demoContentItems.reduce((s, i) => s + i.quizCount, 0)} Quizze
          </p>
        </div>
        <Button
          onClick={() => showDemoToast('Neuen Kurs erstellen')}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Neuer Kurs
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-xs">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Kurs suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'published', 'draft', 'archived'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              {f === 'all'
                ? `Alle (${demoContentItems.length})`
                : f === 'published'
                  ? `Veröffentlicht (${totals.published})`
                  : f === 'draft'
                    ? `Entwurf (${totals.draft})`
                    : `Archiviert (${totals.archived})`}
            </button>
          ))}
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredItems.map(item => (
          <Card
            key={item.id}
            className="glass-effect border-border/40 transition-all duration-200 hover:ring-1 hover:ring-accent/30"
          >
            <CardContent className="p-6">
              <div className="mb-4 flex items-start justify-between">
                <Badge variant="secondary" className="text-xs">
                  {item.component}
                </Badge>
                {statusBadge(item.status)}
              </div>

              <h3 className="text-foreground mb-2 text-sm font-semibold leading-tight">
                {item.title}
              </h3>
              <p className="text-muted-foreground mb-4 text-xs">{item.description}</p>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="bg-background/50 flex items-center gap-2 rounded-lg p-2">
                  <BookOpen className="h-4 w-4 text-blue-500" />
                  <div>
                    <p className="text-foreground text-sm font-bold">
                      {item.enablerCount}
                    </p>
                    <p className="text-muted-foreground text-[10px]">Enabler</p>
                  </div>
                </div>
                <div className="bg-background/50 flex items-center gap-2 rounded-lg p-2">
                  <HelpCircle className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="text-foreground text-sm font-bold">
                      {item.quizCount}
                    </p>
                    <p className="text-muted-foreground text-[10px]">Quizze</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">
                  Aktualisiert:{' '}
                  {new Date(item.lastUpdated).toLocaleDateString('de-DE')}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => showDemoToast('Kurs bearbeiten')}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => showDemoToast('Weitere Optionen')}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Keine Kurse gefunden.</p>
        </div>
      )}
    </div>
  );
}
