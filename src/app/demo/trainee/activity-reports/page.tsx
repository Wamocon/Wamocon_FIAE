'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  demoReports,
  type DemoReport,
} from '@/components/demo/data/demoActivityReports';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Search,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Send,
  Download,
  Edit3,
  Calendar,
  Filter,
} from 'lucide-react';
import { useState, useMemo } from 'react';

export default function DemoTraineeActivityReports() {
  const { showDemoToast } = useDemo();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'draft' | 'submitted' | 'approved' | 'rejected'
  >('all');
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  // Only show Max Müller's reports (trainee view = own reports)
  const myReports = useMemo(
    () => demoReports.filter(r => r.traineeId === 'demo-trainee-001'),
    []
  );

  const filteredReports = useMemo(() => {
    let reports = myReports;
    if (filter !== 'all') {
      reports = reports.filter(r => r.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      reports = reports.filter(
        r =>
          r.week.toLowerCase().includes(q) ||
          r.entries.some(e => e.activity.toLowerCase().includes(q))
      );
    }
    return reports;
  }, [myReports, search, filter]);

  const totals = {
    draft: myReports.filter(r => r.status === 'draft').length,
    submitted: myReports.filter(r => r.status === 'submitted').length,
    approved: myReports.filter(r => r.status === 'approved').length,
    rejected: myReports.filter(r => r.status === 'rejected').length,
  };

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
        return (
          <Badge variant="secondary">
            <Edit3 className="mr-1 h-3 w-3" />
            Entwurf
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">
            Meine Tätigkeitsnachweise
          </h1>
          <p className="text-muted-foreground mt-1">
            {myReports.length} Nachweise &middot; {totals.approved} genehmigt
            &middot; {totals.submitted} ausstehend
          </p>
        </div>
        <button
          onClick={() => showDemoToast('Neuen Nachweis erstellen')}
          className="bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Neuer Nachweis
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-foreground font-bold">{myReports.length}</p>
              <p className="text-muted-foreground text-xs">Gesamt</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-foreground font-bold">{totals.submitted}</p>
              <p className="text-muted-foreground text-xs">Eingereicht</p>
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
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Nach KW oder Tätigkeit suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'draft', 'submitted', 'approved', 'rejected'] as const).map(
            f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-accent/20 text-accent ring-accent/30 ring-1'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                {f === 'all'
                  ? 'Alle'
                  : f === 'draft'
                    ? 'Entwurf'
                    : f === 'submitted'
                      ? 'Eingereicht'
                      : f === 'approved'
                        ? 'Genehmigt'
                        : 'Abgelehnt'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-3">
        {filteredReports.map(report => {
          const isExpanded = expandedReport === report.id;
          return (
            <Card
              key={report.id}
              className="glass-effect border-border/40 overflow-hidden transition-all duration-200"
            >
              <CardContent className="p-0">
                {/* Report Row */}
                <div
                  className="flex cursor-pointer items-center justify-between p-5"
                  onClick={() =>
                    setExpandedReport(isExpanded ? null : report.id)
                  }
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/20 flex h-12 w-12 items-center justify-center rounded-xl">
                      <Calendar className="text-accent h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-foreground font-semibold">
                          {report.week} / {report.year}
                        </h3>
                        {statusBadge(report.status)}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {report.totalHours} Stunden &middot; Eingereicht{' '}
                        {new Date(report.submittedAt).toLocaleDateString(
                          'de-DE',
                          {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          }
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {report.status === 'approved' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          showDemoToast('PDF herunterladen');
                        }}
                        className="text-muted-foreground hover:text-accent rounded-lg p-2 transition-colors"
                        title="PDF herunterladen"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="text-muted-foreground h-5 w-5" />
                    ) : (
                      <ChevronRight className="text-muted-foreground h-5 w-5" />
                    )}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-border/40 border-t px-5 pt-4 pb-5">
                    {/* Feedback from trainer */}
                    {report.feedback && (
                      <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                        <p className="text-xs font-semibold text-green-400">
                          Feedback vom Ausbilder
                        </p>
                        <p className="text-foreground mt-1 text-sm italic">
                          &ldquo;{report.feedback}&rdquo;
                        </p>
                      </div>
                    )}

                    {/* Daily entries table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-border/30 border-b">
                            <th className="text-muted-foreground py-2 text-left text-xs font-medium">
                              Tag
                            </th>
                            <th className="text-muted-foreground py-2 text-left text-xs font-medium">
                              Tätigkeit
                            </th>
                            <th className="text-muted-foreground py-2 text-right text-xs font-medium">
                              Stunden
                            </th>
                            <th className="text-muted-foreground py-2 text-left text-xs font-medium">
                              Kategorie
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.entries.map((entry, idx) => (
                            <tr
                              key={idx}
                              className="border-border/20 border-b last:border-0"
                            >
                              <td className="text-foreground py-2.5 font-medium">
                                {entry.day}
                              </td>
                              <td className="text-foreground py-2.5">
                                {entry.activity}
                              </td>
                              <td className="text-foreground py-2.5 text-right">
                                {entry.hours}h
                              </td>
                              <td className="py-2.5">
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {entry.category}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-border/30 border-t">
                            <td className="text-foreground py-2.5 font-bold">
                              Gesamt
                            </td>
                            <td />
                            <td className="text-foreground py-2.5 text-right font-bold">
                              {report.totalHours}h
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Action buttons (non-functional, demo only) */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {report.status === 'draft' && (
                        <>
                          <button
                            onClick={() => showDemoToast('Nachweis bearbeiten')}
                            className="bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                          >
                            <Edit3 className="h-3 w-3" />
                            Bearbeiten
                          </button>
                          <button
                            onClick={() => showDemoToast('Nachweis einreichen')}
                            className="flex items-center gap-1.5 rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
                          >
                            <Send className="h-3 w-3" />
                            Einreichen
                          </button>
                        </>
                      )}
                      {report.status === 'approved' && (
                        <button
                          onClick={() => showDemoToast('PDF herunterladen')}
                          className="bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                        >
                          <Download className="h-3 w-3" />
                          PDF herunterladen
                        </button>
                      )}
                      {report.status === 'rejected' && (
                        <button
                          onClick={() => showDemoToast('Nachweis überarbeiten')}
                          className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/30"
                        >
                          <Edit3 className="h-3 w-3" />
                          Überarbeiten
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredReports.length === 0 && (
        <div className="py-12 text-center">
          <FileText className="text-muted-foreground mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="text-muted-foreground">
            Keine Tätigkeitsnachweise gefunden.
          </p>
        </div>
      )}
    </div>
  );
}
