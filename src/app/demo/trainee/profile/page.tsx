'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { demoTraineeProfile } from '@/components/demo/data/demoProfiles';
import { traineeStats } from '@/components/demo/data/demoDashboardTrainee';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Mail,
  Phone,
  Building,
  Calendar,
  Award,
  Code,
  Edit,
  Shield,
} from 'lucide-react';

export default function DemoTraineeProfile() {
  const { showDemoToast } = useDemo();

  const p = demoTraineeProfile;
  const initials = p.full_name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Profile Header */}
      <Card className="glass-effect border-border/40 overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-red-600/30 via-red-500/20 to-red-700/30" />
        <CardContent className="relative -mt-16 p-6">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-end">
            <Avatar className="h-28 w-28 ring-4 ring-background">
              <AvatarFallback className="bg-gradient-to-br from-red-500 to-red-700 text-3xl font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-foreground text-2xl font-bold">{p.full_name}</h1>
                <Badge className="bg-green-500/20 text-green-400">Aktiv</Badge>
              </div>
              <p className="text-muted-foreground mt-1">{p.bio}</p>
            </div>
            <button
              onClick={() => showDemoToast('Profil bearbeiten')}
              className="flex items-center gap-2 rounded-xl bg-accent/20 px-4 py-2 text-sm font-medium text-accent transition-all hover:bg-accent/30"
            >
              <Edit className="h-4 w-4" />
              Bearbeiten
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Contact Info */}
        <Card className="glass-effect border-border/40 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Kontaktdaten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-sm">{p.email}</span>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-sm">{p.phone}</span>
            </div>
            <div className="flex items-center gap-3">
              <Building className="text-muted-foreground h-4 w-4" />
              <div>
                <p className="text-foreground text-sm">{p.company}</p>
                <p className="text-muted-foreground text-xs">{p.department}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="text-muted-foreground h-4 w-4" />
              <div>
                <p className="text-foreground text-sm">Ausbildungsstart</p>
                <p className="text-muted-foreground text-xs">
                  {new Date(p.training_start_date!).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats + Skills */}
        <div className="space-y-6 lg:col-span-2">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="glass-effect border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-foreground text-2xl font-bold">
                  {traineeStats.overallProgress}%
                </p>
                <p className="text-muted-foreground text-xs">Fortschritt</p>
              </CardContent>
            </Card>
            <Card className="glass-effect border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-foreground text-2xl font-bold">
                  {traineeStats.quizAverage}%
                </p>
                <p className="text-muted-foreground text-xs">Quiz</p>
              </CardContent>
            </Card>
            <Card className="glass-effect border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-foreground text-2xl font-bold">
                  {traineeStats.completedModules}
                </p>
                <p className="text-muted-foreground text-xs">Module</p>
              </CardContent>
            </Card>
            <Card className="glass-effect border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-foreground text-2xl font-bold">
                  {traineeStats.totalHours}h
                </p>
                <p className="text-muted-foreground text-xs">Lernstunden</p>
              </CardContent>
            </Card>
          </div>

          {/* Skills */}
          <Card className="glass-effect border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Code className="h-5 w-5 text-blue-500" />
                Kompetenzen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {p.skills.map(skill => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Certifications */}
          <Card className="glass-effect border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Award className="h-5 w-5 text-yellow-500" />
                Zertifizierungen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {p.certifications.map(cert => (
                <div
                  key={cert.name}
                  className="bg-background/50 flex items-center justify-between rounded-xl p-4"
                >
                  <div className="flex items-center gap-3">
                    <Shield
                      className={`h-5 w-5 ${
                        cert.status === 'completed'
                          ? 'text-green-500'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <div>
                      <p className="text-foreground text-sm font-medium">{cert.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(cert.date).toLocaleDateString('de-DE', {
                          month: 'long',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={
                      cert.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }
                  >
                    {cert.status === 'completed' ? 'Abgeschlossen' : 'Geplant'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
