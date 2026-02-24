'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  demoLernfelder,
  demoExams,
  demoSchoolCalendar,
  demoSchoolNotes,
} from '@/components/demo/data/demoSchool';
import {
  BookOpen,
  Calendar,
  FileText,
  GraduationCap,
  Clock,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

export default function DemoTraineeSchool() {
  const gradeColor = (grade?: number) => {
    if (!grade) return '';
    if (grade <= 2.0) return 'text-green-400';
    if (grade <= 3.0) return 'text-amber-400';
    return 'text-red-400';
  };

  const avgGrade =
    demoLernfelder.filter(l => l.grade).reduce((sum, l) => sum + (l.grade || 0), 0) /
    demoLernfelder.filter(l => l.grade).length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Berufsschule</h1>
        <p className="text-muted-foreground mt-1">
          Lernfelder, Pr\u00fcfungen, Kalender und Notizen
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <BookOpen className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-foreground font-bold">
                {demoLernfelder.filter(l => l.status === 'completed').length}/
                {demoLernfelder.length}
              </p>
              <p className="text-muted-foreground text-xs">Lernfelder</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <GraduationCap className="h-5 w-5 text-green-500" />
            <div>
              <p className={`font-bold ${gradeColor(avgGrade)}`}>
                {avgGrade.toFixed(1)}
              </p>
              <p className="text-muted-foreground text-xs">\u00d8 Note</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Calendar className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-foreground font-bold">
                {demoExams.filter(e => e.status === 'upcoming').length}
              </p>
              <p className="text-muted-foreground text-xs">Anstehende Pr\u00fcfungen</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-foreground font-bold">{demoSchoolNotes.length}</p>
              <p className="text-muted-foreground text-xs">Notizen</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="lernfelder">
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="lernfelder">Lernfelder</TabsTrigger>
          <TabsTrigger value="exams">Pr\u00fcfungen</TabsTrigger>
          <TabsTrigger value="calendar">Kalender</TabsTrigger>
          <TabsTrigger value="notes">Notizen</TabsTrigger>
        </TabsList>

        {/* Lernfelder */}
        <TabsContent value="lernfelder" className="mt-6 space-y-3">
          {demoLernfelder.map(lf => (
            <Card key={lf.id} className="glass-effect border-border/40">
              <CardContent className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${
                      lf.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : lf.status === 'in_progress'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    LF{lf.number}
                  </div>
                  <div>
                    <h3 className="text-foreground text-sm font-semibold">
                      {lf.title}
                    </h3>
                    <p className="text-muted-foreground text-xs">
                      {lf.hours} Stunden &middot; {lf.year}. Lehrjahr &middot;{' '}
                      {lf.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {lf.grade && (
                    <span className={`text-lg font-bold ${gradeColor(lf.grade)}`}>
                      {lf.grade.toFixed(1)}
                    </span>
                  )}
                  {lf.status === 'completed' ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : lf.status === 'in_progress' ? (
                    <Clock className="h-5 w-5 text-amber-500" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Exams */}
        <TabsContent value="exams" className="mt-6 space-y-3">
          {demoExams.map(exam => (
            <Card key={exam.id} className="glass-effect border-border/40">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-foreground font-semibold">{exam.title}</h3>
                      <Badge
                        className={
                          exam.status === 'upcoming'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-green-500/20 text-green-400'
                        }
                      >
                        {exam.status === 'upcoming' ? 'Anstehend' : 'Abgeschlossen'}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {new Date(exam.date).toLocaleDateString('de-DE', {
                        weekday: 'long',
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}{' '}
                      &middot; {exam.type} &middot; {exam.duration}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {exam.topics.map(t => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {exam.grade !== undefined && (
                    <span
                      className={`text-xl font-bold ${gradeColor(exam.grade)}`}
                    >
                      {exam.grade.toFixed(1)}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Calendar */}
        <TabsContent value="calendar" className="mt-6 space-y-3">
          {demoSchoolCalendar.map((item, i) => (
            <Card key={i} className="glass-effect border-border/40">
              <CardContent className="flex items-center gap-4 p-4">
                <div
                  className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl text-xs font-bold ${
                    item.type === 'exam'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  <span>
                    {new Date(item.date).toLocaleDateString('de-DE', { day: '2-digit' })}
                  </span>
                  <span className="text-[10px]">
                    {new Date(item.date).toLocaleDateString('de-DE', { month: 'short' })}
                  </span>
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">{item.event}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(item.date).toLocaleDateString('de-DE', {
                      weekday: 'long',
                    })}
                  </p>
                </div>
                {item.type === 'exam' && (
                  <AlertCircle className="ml-auto h-4 w-4 text-red-400" />
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Notes */}
        <TabsContent value="notes" className="mt-6 space-y-3">
          {demoSchoolNotes.map(note => (
            <Card key={note.id} className="glass-effect border-border/40">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-foreground font-semibold">{note.title}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{note.content}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="secondary">{note.lernfeld}</Badge>
                    <p className="text-muted-foreground mt-1 text-xs">{note.date}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
