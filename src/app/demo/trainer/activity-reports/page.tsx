'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { demoReports } from '@/components/demo/data/demoActivityReports';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Search,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { useState, useMemo } from 'react';

export default function DemoTrainerActivityReports() {
  const { showDemoToast } = useDemo();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'submitted' | 'approved' | 'rejected'>('all');

  const filteredReports = useMemo(() => {
    let reports = demoReports;
    if (filter !== 'all') {
      reports = reports.filter(r => r.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      reports = reports.filter(
        r =>
          r.trainee.toLowerCase().includes(q) ||
          r.week.toLowerCase().includes(q)
      );
    }
    return reports;
  }, [search, filter]);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return (
          <Badge className="bg-amber-500/20 text-amber-400">
            <Clock className="mr-1 h-3 w-3" />
            Eingereicht
          </Badge>
        );
      case 'approved':
        return (
          <Badge className="bg-green-500/20 text-green-400">
            <CheckCircle className="mr-1 h-3 w-3" />
            Genehmigt
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-500/20 text-red-400">
            <XCircle className="mr-1 h-3 w-3" />
            Abgelehnt
          </Badge>
        );
      default:
        return <Badge variant="secondary">Entwurf</Badge>;
    }
  };

  const totals = {
    submitted: demoReports.filter(r => r.status === 'submitted').length,
    approved: demoReports.filter(r => r.status === 'approved').length,
    rejected: demoReports.filter(r => r.status === 'rejected').length,
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Tätigkeitsnachweise</h1>
          <p className="text-muted-foreground mt-1">
            {totals.submitted} ausstehend &middot; {totals.approved} genehmigt
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-foreground font-bold">{demoReports.length}</p>
              <p className="text-muted-foreground text-xs">Gesamt</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-foreground font-bold">{totals.submitted}</p>
              <p className="text-muted-foreground text-xs">Ausstehend</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-foreground font-bold">{totals.approved}</p>
              <p className="text-muted-foreground text-xs">Genehmigt</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-foreground font-bold">{totals.rejected}</p>
              <p className="text-muted-foreground text-xs">Abgelehnt</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-xs">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Nach Azubi oder KW suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'submitted', 'approved', 'rejected'] as const).map(f => (
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
                ? 'Alle'
                : f === 'submitted'
                  ? 'Ausstehend'
                  : f === 'approved'
                    ? 'Genehmigt'
                    : 'Abgelehnt'}
            </button>
          ))}
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-3">
        {filteredReports.map(report => (
          <Card
            key={report.id}
            className="glass-effect border-border/40 cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-accent/30"
            onClick={() => showDemoToast('Bericht öffnen')}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/20">
                    <FileText className="text-accent h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-foreground font-semibold">
                        {report.week} / {report.year}
                      </h3>
                      {statusBadge(report.status)}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      {report.trainee} &middot; {report.totalHours}h &middot; Eingereicht{' '}
                      {new Date(report.submittedAt).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </p>
                    {report.feedback && (
                      <p className="text-muted-foreground mt-1 text-xs italic">
                        &ldquo;{report.feedback}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
                <ChevronRight className="text-muted-foreground h-5 w-5 shrink-0" />
              </div>

              {/* Activity Summary */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[...new Set(report.entries.map(e => e.category))].map(cat => (
                  <Badge key={cat} variant="secondary" className="text-[10px]">
                    {cat}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredReports.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Keine Berichte gefunden.</p>
        </div>
      )}
    </div>
  );
}
