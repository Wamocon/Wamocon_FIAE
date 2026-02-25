'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { demoCourses } from '@/components/demo/data/demoCourses';
import { useDemo } from '@/components/demo/DemoContext';
import { Search, CheckCircle, Clock, Lock } from 'lucide-react';
import { useState, useMemo } from 'react';

export default function DemoTraineeCourses() {
  const { showDemoToast } = useDemo();
  const [search, setSearch] = useState('');

  const filteredCourses = useMemo(() => {
    if (!search.trim()) return demoCourses;
    const q = search.toLowerCase();
    return demoCourses.filter(
      c =>
        c.title.toLowerCase().includes(q) ||
        c.component.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [search]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-amber-500" />;
      default:
        return <Lock className="h-5 w-5 text-muted-foreground/50" />;
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-400">Abgeschlossen</Badge>;
      case 'in_progress':
        return <Badge className="bg-amber-500/20 text-amber-400">In Bearbeitung</Badge>;
      default:
        return <Badge variant="secondary">Nicht begonnen</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Meine Kurse</h1>
          <p className="text-muted-foreground mt-1">
            {demoCourses.filter(c => c.status === 'completed').length} von{' '}
            {demoCourses.length} Kursen abgeschlossen
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Kurs suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Overall Progress */}
      <Card className="glass-effect border-border/40">
        <CardContent className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-foreground font-semibold">Gesamtfortschritt</span>
            <span className="text-accent font-bold">
              {Math.round(
                demoCourses.reduce((sum, c) => sum + c.progress, 0) / demoCourses.length
              )}
              %
            </span>
          </div>
          <Progress
            value={
              demoCourses.reduce((sum, c) => sum + c.progress, 0) / demoCourses.length
            }
            className="h-3"
          />
        </CardContent>
      </Card>

      {/* Course Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredCourses.map(course => (
          <Card
            key={course.id}
            className="glass-effect border-border/40 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:ring-1 hover:ring-accent/30"
            onClick={() => showDemoToast('Kurs \u00f6ffnen')}
          >
            <CardContent className="p-6">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{course.icon}</span>
                  {statusIcon(course.status)}
                </div>
                {statusBadge(course.status)}
              </div>

              <h3 className="text-foreground mb-1 text-sm font-semibold leading-tight">
                {course.title}
              </h3>
              <p className="text-muted-foreground mb-4 text-xs">
                {course.component} &middot; {course.totalEnablers} Enabler
              </p>
              <p className="text-muted-foreground mb-4 line-clamp-2 text-xs">
                {course.description}
              </p>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {course.completedEnablers}/{course.totalEnablers} Enabler
                  </span>
                  <span className="text-foreground font-semibold">
                    {course.progress}%
                  </span>
                </div>
                <Progress value={course.progress} className="h-2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredCourses.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Keine Kurse gefunden.</p>
        </div>
      )}
    </div>
  );
}
