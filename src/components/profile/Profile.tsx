'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { User, Edit3, Award, Clock, Target, TrendingUp, Users, Upload, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FILE_UPLOAD } from '@/lib/constants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function Profile() {
  const { profile, updateProfile, changePassword } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editedProfile, setEditedProfile] = useState({
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    role: profile?.role || 'trainee',
    training_start_date: profile?.training_start_date || '',
  });
  const [stats, setStats] = useState<{ trainees?: number; activeCourses?: number; pendingReviews?: number; recentActivity7d?: number } | null>(null);
  const [activities, setActivities] = useState<Array<{ id: string; userId: string; activityType: string; createdAt: string }>>([]);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [showPwSection, setShowPwSection] = useState(false);

  // Load trainer-specific stats (declare hooks before any conditional return)
  useEffect(() => {
    const load = async () => {
      try {
        if (!profile?.id || profile.role !== 'trainer') return;
        const url = `/api/trainer/profile?trainerId=${profile.id}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data: {
          counts?: { trainees?: number; activeCourses?: number; pendingReviews?: number; recentActivity7d?: number };
          recentActivities?: Array<{ id: string; userId?: string; activityType: string; createdAt?: string | null }>;
        } = await res.json();
        setStats(data.counts || null);
        const recent = Array.isArray(data.recentActivities)
          ? (data.recentActivities as Array<{ id: string; userId?: string; activityType: string; createdAt?: string | null }>).map((r) => ({
              id: r.id,
              userId: r.userId || '',
              activityType: r.activityType,
              createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
            }))
          : [];
        setActivities(recent);
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, [profile?.id, profile?.role]);

  if (!profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground mt-4">Lade Profil...</p>
        </div>
      </div>
    );
  }

  

  const handleSave = async () => {
    try {
      await updateProfile({ full_name: editedProfile.full_name });
    } finally {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditedProfile({
      full_name: profile.full_name || '',
      email: profile.email || '',
      role: profile.role || 'trainee',
      training_start_date: profile.training_start_date || '',
    });
    setIsEditing(false);
  };

  const handlePasswordChange = async () => {
    setPwMsg(null);
    if (!pw1 || pw1.length < 8) {
      setPwMsg('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg('Die Passwörter stimmen nicht überein.');
      return;
    }
    try {
      setPwBusy(true);
      await changePassword(pw1);
      setPwMsg('Passwort erfolgreich geändert.');
      setPw1('');
      setPw2('');
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'message' in e && typeof (e as any).message === 'string'
        ? (e as any).message
        : 'Passwort konnte nicht geändert werden';
      setPwMsg(message);
    } finally {
      setPwBusy(false);
    }
  };

  const handleChooseFile = () => fileInputRef.current?.click();

  const handleAvatarUpload = async (file: File) => {
    if (!profile) {
      alert('Nicht angemeldet. Bitte melden Sie sich erneut an.');
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !FILE_UPLOAD.allowedTypes.includes(ext)) {
      alert(`Ungültiger Dateityp. Erlaubt: ${FILE_UPLOAD.allowedTypes.join(', ')}`);
      return;
    }
    if (file.size > FILE_UPLOAD.maxSize) {
      alert('Datei ist zu groß. Maximal 10MB.');
      return;
    }

    try {
      setIsUploading(true);
      const path = `${profile.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = data.publicUrl;
      await updateProfile({ avatar_url: publicUrl });
    } catch (e: unknown) {
      console.error('Avatar upload error:', e);
      const msg = typeof e === 'object' && e && 'message' in e && typeof (e as any).message === 'string' ? (e as any).message : String(e);
      const hint = msg.toLowerCase().includes('not found')
        ? '\nHinweis: Existiert der Storage-Bucket "avatars" und ist er öffentlich?'
        : '';
      alert(`Upload fehlgeschlagen. Bitte erneut versuchen.\n\nFehler: ${msg}${hint}`);
    } finally {
      setIsUploading(false);
    }
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleAvatarUpload(f);
    // reset input so same file can be picked again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="bg-background min-h-screen p-6">
      {/* Profile Header */}
      <div className="bg-card border-border rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center space-x-6">
          <div className="relative">
            <Avatar className="h-20 w-20">
              {profile.avatar ? (
                <AvatarImage src={profile.avatar} alt={profile.full_name} />
              ) : (
                <AvatarFallback>
                  <User className="h-8 w-8" />
                </AvatarFallback>
              )}
            </Avatar>
            {isEditing && (
              <button
                type="button"
                onClick={handleChooseFile}
                disabled={isUploading}
                className="bg-accent/90 hover:bg-accent text-accent-foreground absolute -bottom-2 -right-2 rounded-full p-2 shadow transition disabled:opacity-70"
                title="Profilbild ändern"
              >
                <Upload className="h-4 w-4" />
              </button>
            )}
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              {isEditing ? (
                <input
                  type="text"
                  value={editedProfile.full_name}
                  onChange={e =>
                    setEditedProfile({
                      ...editedProfile,
                      full_name: e.target.value,
                    })
                  }
                  className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-2 focus:border-transparent focus:ring-2 focus:outline-none"
                />
              ) : (
                profile.full_name
              )}
            </h1>
            <p className="text-muted-foreground text-lg">
              {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isUploading && (
              <span className="text-muted-foreground text-sm">Lade hoch…</span>
            )}
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="bg-accent/10 hover:bg-accent/20 rounded-xl p-3 transition-colors"
            >
              <Edit3 className="text-accent h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Personal Information */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          Persönliche Informationen
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              Vollständiger Name
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editedProfile.full_name}
                onChange={e =>
                  setEditedProfile({
                    ...editedProfile,
                    full_name: e.target.value,
                  })
                }
                className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
              />
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.full_name}
              </div>
            )}
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              E-Mail
            </label>
            {isEditing ? (
              <input
                type="email"
                value={editedProfile.email}
                onChange={e =>
                  setEditedProfile({ ...editedProfile, email: e.target.value })
                }
                className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
              />
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.email}
              </div>
            )}
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              Rolle
            </label>
            <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
              {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
            </div>
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              {profile.role === 'trainee' ? 'Ausbildungsstart' : 'Benutzer-ID'}
            </label>
            {profile.role === 'trainee' ? (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.training_start_date || 'Nicht angegeben'}
              </div>
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3 select-all">
                {profile.id}
              </div>
            )}
          </div>
                    {/* Change Password */}
              {/* Change Password */}
              <div className="bg-card border-border mt-6 rounded-3xl border p-0 shadow-lg overflow-hidden">
                <button
                  onClick={() => setShowPwSection(s => !s)}
                  className="flex w-full items-center justify-between px-6 py-5"
                  aria-expanded={showPwSection}
                >
                  <div className="flex items-center gap-3">
                    <span className="from-accent to-primary inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                      <Lock className="h-5 w-5 text-white" />
                    </span>
                    <span className="text-foreground text-xl font-semibold">Passwort ändern</span>
                  </div>
                  <span className="text-muted-foreground text-sm">{showPwSection ? 'Schließen' : 'Öffnen'}</span>
                </button>
                {showPwSection && (
                  <div className="px-6 pb-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div>
                        <label className="text-muted-foreground mb-2 block text-sm font-medium">Neues Passwort</label>
                        <input
                          type="password"
                          value={pw1}
                          onChange={(e) => setPw1(e.target.value)}
                          placeholder="Mindestens 8 Zeichen"
                          className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label className="text-muted-foreground mb-2 block text-sm font-medium">Passwort bestätigen</label>
                        <input
                          type="password"
                          value={pw2}
                          onChange={(e) => setPw2(e.target.value)}
                          className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                    {pwMsg && (
                      <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${pwMsg.includes('erfolgreich') ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}`}>
                        {pwMsg}
                      </div>
                    )}
                    <div className="mt-6">
                      <button
                        onClick={handlePasswordChange}
                        disabled={pwBusy}
                        className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-3 transition-colors disabled:opacity-60"
                      >
                        {pwBusy ? 'Ändere…' : 'Passwort ändern'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
        </div>

        {isEditing && (
          <div className="mt-6 flex space-x-4">
            <button
              onClick={handleSave}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              Speichern
            </button>
            <button
              onClick={handleCancel}
              className="bg-muted text-muted-foreground hover:bg-muted/80 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">Statistiken</h2>
        {profile.role === 'trainer' ? (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="text-center">
              <Users className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Azubis</p>
              <p className="text-foreground text-2xl font-bold">{stats?.trainees ?? 0}</p>
            </div>
            <div className="text-center">
              <Target className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Aktive Kurse</p>
              <p className="text-foreground text-2xl font-bold">{stats?.activeCourses ?? 0}</p>
            </div>
            <div className="text-center">
              <Clock className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Offene Reviews</p>
              <p className="text-foreground text-2xl font-bold">{stats?.pendingReviews ?? 0}</p>
            </div>
            <div className="text-center">
              <TrendingUp className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Aktivität (7T)</p>
              <p className="text-foreground text-2xl font-bold">{stats?.recentActivity7d ?? 0}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="text-center">
              <Award className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Module abgeschlossen</p>
              <p className="text-foreground text-2xl font-bold">12</p>
            </div>
            <div className="text-center">
              <Target className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Zertifikate</p>
              <p className="text-foreground text-2xl font-bold">8</p>
            </div>
            <div className="text-center">
              <Clock className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Lernstunden</p>
              <p className="text-foreground text-2xl font-bold">156</p>
            </div>
            <div className="text-center">
              <TrendingUp className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">Ziel erreicht</p>
              <p className="text-foreground text-2xl font-bold">85%</p>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activities */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">Letzte Aktivitäten</h2>
        {profile.role === 'trainer' ? (
          <div className="space-y-4">
            {activities.length === 0 && (
              <div className="text-muted-foreground">Keine Aktivitäten gefunden</div>
            )}
            {activities.map((a) => (
              <div key={a.id} className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
                <span className="text-muted-foreground">{a.activityType}</span>
                <span className="text-muted-foreground ml-auto text-sm">
                  {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">Modul &quot;JavaScript Grundlagen&quot; abgeschlossen</span>
              <span className="text-muted-foreground ml-auto text-sm">vor 2 Stunden</span>
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">Quiz &quot;HTML &amp; CSS&quot; bestanden</span>
              <span className="text-muted-foreground ml-auto text-sm">vor 1 Tag</span>
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">Reflexion eingereicht</span>
              <span className="text-muted-foreground ml-auto text-sm">vor 3 Tagen</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
