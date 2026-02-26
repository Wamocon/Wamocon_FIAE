'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { demoTrainees } from '@/components/demo/data/demoProfiles';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Search,
  Mail,
  TrendingUp,
  BookOpen,
  HelpCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useState, useMemo } from 'react';

export default function DemoTrainerTrainees() {
  const { showDemoToast } = useDemo();
  const [search, setSearch] = useState('');

  const filteredTrainees = useMemo(() => {
    if (!search.trim()) return demoTrainees;
    const q = search.toLowerCase();
    return demoTrainees.filter(
      t =>
        t.full_name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.currentModule.toLowerCase().includes(q)
    );
  }, [search]);

  const statusBadge = (status: string, lastActive: string) => {
    const daysSince = Math.floor(
      (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (status === 'inactive' || daysSince > 3) {
      return (
        <Badge className="bg-red-500/20 text-red-400">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Inaktiv
        </Badge>
      );
    }
    return <Badge className="bg-green-500/20 text-green-400">Aktiv</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Auszubildende</h1>
          <p className="text-muted-foreground mt-1">
            {demoTrainees.filter(t => t.status === 'active').length} aktiv &middot;{' '}
            {demoTrainees.length} gesamt
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Azubi suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-foreground text-2xl font-bold">{demoTrainees.length}</p>
            <p className="text-muted-foreground text-xs">Gesamt</p>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-foreground text-2xl font-bold">
              {Math.round(
                demoTrainees.reduce((s, t) => s + t.progress, 0) / demoTrainees.length
              )}
              %
            </p>
            <p className="text-muted-foreground text-xs">Ø Fortschritt</p>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-foreground text-2xl font-bold">
              {Math.round(
                demoTrainees.reduce((s, t) => s + t.quizAvg, 0) / demoTrainees.length
              )}
              %
            </p>
            <p className="text-muted-foreground text-xs">Ø Quiz-Score</p>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-foreground text-2xl font-bold">
              {demoTrainees.filter(t => t.status === 'inactive').length}
            </p>
            <p className="text-muted-foreground text-xs">Inaktiv</p>
          </CardContent>
        </Card>
      </div>

      {/* Trainee Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredTrainees.map(trainee => {
          const initials = trainee.full_name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase();

          return (
            <Card
              key={trainee.id}
              className="glass-effect border-border/40 cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-accent/30"
              onClick={() => showDemoToast('Azubi-Profil öffnen')}
            >
              <CardContent className="p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="bg-gradient-to-br from-accent to-accent/80 text-sm font-bold text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-foreground font-semibold">
                        {trainee.full_name}
                      </h3>
                      <p className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Mail className="h-3 w-3" />
                        {trainee.email}
                      </p>
                    </div>
                  </div>
                  {statusBadge(trainee.status, trainee.lastActive)}
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2">
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <TrendingUp className="text-accent mx-auto mb-1 h-4 w-4" />
                    <p className="text-foreground text-sm font-bold">
                      {trainee.progress}%
                    </p>
                    <p className="text-muted-foreground text-[10px]">Fortschritt</p>
                  </div>
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <HelpCircle className="mx-auto mb-1 h-4 w-4 text-purple-500" />
                    <p className="text-foreground text-sm font-bold">
                      {trainee.quizAvg}%
                    </p>
                    <p className="text-muted-foreground text-[10px]">Quiz</p>
                  </div>
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <BookOpen className="mx-auto mb-1 h-4 w-4 text-blue-500" />
                    <p className="text-foreground text-sm font-bold">
                      {trainee.completedModules}/{trainee.totalModules}
                    </p>
                    <p className="text-muted-foreground text-[10px]">Module</p>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Aktuell: {trainee.currentModule}
                    </span>
                    <span className="text-foreground font-medium">
                      {trainee.progress}%
                    </span>
                  </div>
                  <Progress value={trainee.progress} className="h-2" />
                </div>

                <p className="text-muted-foreground mt-3 flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  Zuletzt aktiv:{' '}
                  {new Date(trainee.lastActive).toLocaleDateString('de-DE')}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredTrainees.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Keine Azubis gefunden.</p>
        </div>
      )}
    </div>
  );
}
