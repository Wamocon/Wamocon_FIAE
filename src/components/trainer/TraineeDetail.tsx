'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  FileCheck2,
  TrendingUp,
  Calendar,
  Award,
  BookOpen,
  Eye,
  MessageSquare,
  Download,
  Share2,
  MoreVertical,
} from 'lucide-react';

interface TraineeDetailProps {
  traineeId: string;
}

export default function TraineeDetail({ traineeId }: TraineeDetailProps) {
  const router = useRouter();
  const { profile } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<
    'overview' | 'progress' | 'submissions' | 'notes'
  >('overview');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<{
    id: string;
    full_name: string;
    avatar_url?: string | null;
    training_start_date?: string | null;
    assigned_trainer_id?: string | null;
    progress: number;
  } | null>(null);
  const [edit, setEdit] = useState({
    full_name: '',
    avatar_url: '',
    start_of_training_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/trainer/trainees/${traineeId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Auszubildenden nicht laden');
        const data = await res.json();
        setTrainee(data.trainee);
        setEdit({
          full_name: data.trainee?.full_name || '',
          avatar_url: data.trainee?.avatar_url || '',
          start_of_training_date: data.trainee?.training_start_date ? String(data.trainee.training_start_date).slice(0, 10) : '',
        });
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (traineeId) load();
  }, [traineeId]);

  const handleAcceptanceProtocol = () => {
    router.push('/trainer/acceptance-protocol');
  };

  const handleSave = async () => {
    if (!profile?.id || !trainee?.id) return;
    try {
      setSaving(true);
      setError(null);
      const payload: any = {
        trainer_id: profile.id,
        full_name: edit.full_name,
        avatar_url: edit.avatar_url,
      };
      if (edit.start_of_training_date) payload.start_of_training_date = edit.start_of_training_date;
      const res = await fetch(`/api/trainer/trainees/${trainee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Änderungen konnten nicht gespeichert werden');
      const data = await res.json();
      setTrainee((prev) => ({
        ...prev!,
        full_name: data.trainee.full_name,
        avatar_url: data.trainee.avatar_url,
        training_start_date: data.trainee.training_start_date,
      }));
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Übersicht', icon: Eye },
    { id: 'progress', label: 'Fortschritt', icon: TrendingUp },
    // { id: 'submissions', label: 'Einreichungen', icon: FileCheck2 },
    // { id: 'notes', label: 'Notizen', icon: MessageSquare },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <div className="relative">
              {trainee?.avatar_url ? (
                <img
                  src={trainee.avatar_url}
                  alt={trainee.full_name}
                  className="border-accent/30 h-24 w-24 rounded-3xl border-4 object-cover shadow-lg"
                />
              ) : (
                <div className="border-accent/30 flex h-24 w-24 items-center justify-center rounded-3xl border-4 bg-muted text-muted shadow-lg">
                  <TrendingUp className="h-6 w-6" />
                </div>
              )}
              <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-500">
                <div className="h-3 w-3 rounded-full bg-white"></div>
              </div>
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {trainee?.full_name || 'Auszubildender'}
              </h1>
              <div className="flex items-center gap-4">
                <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                  Auszubildender
                </span>
                <span className="text-muted">ID: {trainee?.id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEdit((v) => !v)}
                className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200"
              >
                {showEdit ? 'Bearbeiten ausblenden' : 'Bearbeiten'}
              </button>
            <button className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200">
              <Share2 className="h-4 w-4" />
              Teilen
            </button>
            <button className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200">
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={handleAcceptanceProtocol}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              <FileCheck2 className="h-5 w-5" />
              Abnahmeprotokoll
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Gesamtfortschritt</p>
              <p className="text-foreground text-2xl font-bold">{trainee?.progress ?? 0}%</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Module abgeschlossen</p>
              <p className="text-foreground text-2xl font-bold">—</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-violet-500">
              <Award className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Durchschnitt</p>
              <p className="text-foreground text-2xl font-bold">82%</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Letzte Aktivität</p>
              <p className="text-foreground text-2xl font-bold">Heute</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-200">
          <div className="flex overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-8">
          {/* Edit form for trainers */}
          {profile?.role === 'trainer' && trainee && showEdit && (
            <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="mb-4 text-lg font-semibold text-slate-800">Stammdaten bearbeiten</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">Vollständiger Name</label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-800"
                    value={edit.full_name}
                    onChange={(e) => setEdit((p) => ({ ...p, full_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">Avatar URL</label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-800"
                    value={edit.avatar_url}
                    onChange={(e) => setEdit((p) => ({ ...p, avatar_url: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">Start der Ausbildung</label>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-800"
                    value={edit.start_of_training_date}
                    onChange={(e) => setEdit((p) => ({ ...p, start_of_training_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Speichern…' : 'Speichern'}
                </button>
                {error && <div className="text-sm text-red-600">{error}</div>}
              </div>
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Aktuelle Lernaktivitäten
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
                  <h4 className="mb-2 font-semibold text-blue-800">
                    Aktuelles Modul
                  </h4>
                  <p className="text-blue-700">—</p>
                  <div className="mt-3 h-2 w-full rounded-full bg-blue-200">
                    <div
                      className="h-2 rounded-full bg-blue-600"
                      style={{ width: `${trainee?.progress ?? 0}%` }}
                    ></div>
                  </div>
                  <p className="mt-1 text-sm text-blue-600">
                    {trainee?.progress ?? 0}% abgeschlossen
                  </p>
                </div>

                <div className="rounded-2xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6">
                  <h4 className="mb-2 font-semibold text-green-800">
                    Nächster Termin
                  </h4>
                  <p className="text-green-700">—</p>
                  <p className="mt-1 text-sm text-green-600">—</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'progress' && (
            <div className="space-y-6">
              <h3 className="mb-4 text-xl font-bold text-slate-800">
                Lernfortschritt
              </h3>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-semibold text-slate-800">Gesamt</h4>
                  <span className="text-lg font-bold text-blue-600">{trainee?.progress ?? 0}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-200">
                  <div className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500" style={{ width: `${trainee?.progress ?? 0}%` }} />
                </div>
              </div>
            </div>
          )}
          {/* Additional tabs (submissions, notes) can be reintroduced once data is wired */}
        </div>
      </div>
    </div>
  );
}
