'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  User,
  Edit3,
  Award,
  Clock,
  Target,
  TrendingUp,
  Users,
  Upload,
  Lock,
  BookOpen,
  FileText,
  Layers,
  CheckCircle,
  GraduationCap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FILE_UPLOAD } from '@/lib/constants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOnboarding } from '@/contexts/OnboardingContext';

type TrainerStats = {
  trainees: number;
  activeCourses: number;
  totalCourses: number;
  totalEnablers: number;
  totalUseCases: number;
  totalLernfelder: number;
  pendingReviews: number;
  pendingQuizzes: number;
  pendingUseCases: number;
  recentActivity7d: number;
};

type ActivityItem = {
  id: string;
  userFullName?: string;
  activityType: string;
  createdAt: string | null;
  details?: string;
};

export function Profile() {
  const { profile, updateProfile, changePassword } = useAuth();
  const { t } = useLanguage();
  const { restartTour } = useOnboarding();
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editedProfile, setEditedProfile] = useState({
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    role: profile?.role || 'trainee',
    training_start_date: profile?.training_start_date || '',
    birth_date: profile?.birth_date || '',
  });
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [showPwSection, setShowPwSection] = useState(false);

  // Load trainer-specific stats
  useEffect(() => {
    const load = async () => {
      try {
        if (!profile?.id || profile.role !== 'trainer') {
          setStatsLoading(false);
          return;
        }
        const url = `/api/trainer/profile?trainerId=${profile.id}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          setStatsLoading(false);
          return;
        }
        const data = await res.json();
        setStats(data.counts || null);
        const recent = Array.isArray(data.recentActivities)
          ? data.recentActivities.map((r: any) => ({
              id: r.id,
              userFullName: r.userFullName || t('profile.unknown'),
              activityType: r.activityType,
              createdAt: r.createdAt
                ? new Date(r.createdAt).toISOString()
                : null,
              details: r.details || r.activityType,
            }))
          : [];
        setActivities(recent);
      } catch (e) {
        console.error(e);
      } finally {
        setStatsLoading(false);
      }
    };
    load();
  }, [profile?.id, profile?.role]);

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const handleCancel = () => {
    setEditedProfile({
      full_name: profile.full_name || '',
      email: profile.email || '',
      role: profile.role || 'trainee',
      training_start_date: profile.training_start_date || '',
      birth_date: profile.birth_date || '',
    });
    setIsEditing(false);
  };

  const handleEditToggle = () => {
    if (isEditing) {
      // Save changes when exiting edit mode
      void updateProfile({
        full_name: editedProfile.full_name,
        avatar_url: profile.avatar || null,
        birth_date: editedProfile.birth_date || null,
        training_start_date: editedProfile.training_start_date || null,
      });
      toast.success(t('profile.updateSuccess') || 'Profil aktualisiert');
    } else {
      // Reset to current profile data when entering edit mode
      setEditedProfile({
        full_name: profile.full_name || '',
        email: profile.email || '',
        role: profile.role || 'trainee',
        training_start_date: profile.training_start_date || '',
        birth_date: profile.birth_date || '',
      });
    }
    setIsEditing(!isEditing);
  };

  const handlePasswordChange = async () => {
    setPwMsg(null);
    if (!pw1 || pw1.length < 8) {
      setPwMsg(t('profile.passwordMinLength'));
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg(t('profile.passwordMismatch'));
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(pw1);
      setPwMsg(t('profile.passwordChanged'));
      setPw1('');
      setPw2('');
    } catch (e: unknown) {
      const message =
        typeof e === 'object' &&
        e &&
        'message' in e &&
        typeof (e as any).message === 'string'
          ? (e as any).message
          : t('profile.passwordChangeFailed');
      setPwMsg(message);
    } finally {
      setPwBusy(false);
    }
  };

  const handleChooseFile = () => fileInputRef.current?.click();

  const handleAvatarUpload = async (file: File) => {
    if (!profile) {
      toast.error(t('profile.notLoggedIn'));
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !FILE_UPLOAD.allowedTypes.includes(ext)) {
      toast.error(
        `${t('profile.invalidFileType')} ${FILE_UPLOAD.allowedTypes.join(', ')}`
      );
      return;
    }
    if (file.size > FILE_UPLOAD.maxSize) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }

    try {
      setIsUploading(true);
      const path = `${profile.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('avatar')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatar').getPublicUrl(path);
      const publicUrl = data.publicUrl;
      await updateProfile({ avatar_url: publicUrl });
    } catch (e: unknown) {
      console.error('Avatar upload error:', e);
      const msg =
        typeof e === 'object' &&
        e &&
        'message' in e &&
        typeof (e as any).message === 'string'
          ? (e as any).message
          : String(e);
      const hint = msg.toLowerCase().includes('not found')
        ? t('profile.storageBucketHint')
        : '';
      toast.error(`${t('profile.uploadFailed')} ${msg}${hint}`);
    } finally {
      setIsUploading(false);
    }
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async e => {
    const f = e.target.files?.[0];
    if (f) await handleAvatarUpload(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('profile.time.justNow');
    if (diffMins < 60)
      return t('profile.time.minutesAgo').replace(
        '{minutes}',
        String(diffMins)
      );
    if (diffHours < 24)
      return t('profile.time.hoursAgo').replace('{hours}', String(diffHours));
    if (diffDays < 7)
      return (
        diffDays > 1
          ? t('profile.time.daysAgoPlural')
          : t('profile.time.daysAgo')
      ).replace('{days}', String(diffDays));
    return date.toLocaleDateString('de-DE');
  };

  const getActivityIcon = (type: string) => {
    if (type.includes('QUIZ'))
      return (
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
      );
    if (type.includes('USECASE'))
      return (
        <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" />
      );
    if (type.includes('LESSON') || type.includes('COURSE'))
      return <BookOpen className="text-accent h-4 w-4" />;
    return <Clock className="text-muted-foreground h-4 w-4" />;
  };

  return (
    <div className="bg-background min-h-full p-6">
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
                className="bg-accent/90 hover:bg-accent text-accent-foreground absolute -right-2 -bottom-2 rounded-full p-2 shadow transition disabled:opacity-70"
                title={t('profile.changeAvatar')}
              >
                <Upload className="h-4 w-4" />
              </button>
            )}
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
              {profile.role === 'trainee'
                ? t('roles.trainee')
                : t('roles.trainer')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isUploading && (
              <span className="text-muted-foreground text-sm">
                {t('profile.uploading')}
              </span>
            )}
            <button
              onClick={handleEditToggle}
              className="bg-accent/10 hover:bg-accent/20 rounded-xl p-3 transition-colors"
              aria-label={t('profile.editProfile')}
            >
              <Edit3 className="text-accent h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Personal Information */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          {t('profile.personalInfo')}
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="fullName"
              className="text-muted-foreground mb-2 block text-sm font-medium"
            >
              {t('profile.fullName')}
            </label>
            {isEditing ? (
              <input
                id="fullName"
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
              {t('profile.email')}
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
              <div
                className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3"
                data-testid="user-email"
              >
                {profile.email}
              </div>
            )}
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              {t('profile.role')}
            </label>
            <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
              {profile.role === 'trainee'
                ? t('roles.trainee')
                : t('roles.trainer')}
            </div>
          </div>
          <div>
            <label className="text-muted-foreground mb-2 block text-sm font-medium">
              {profile.role === 'trainee'
                ? t('profile.trainingStart')
                : t('profile.userId')}
            </label>
            {profile.role === 'trainee' ? (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.training_start_date || t('profile.notSpecified')}
              </div>
            ) : (
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3 text-sm select-all">
                {profile.id}
              </div>
            )}
          </div>
          {/* Birth Date - For Trainees Only */}
          {profile.role === 'trainee' && (
            <div>
              <label className="text-muted-foreground mb-2 block text-sm font-medium">
                {t('profile.birthDate') || 'Geburtsdatum'}
              </label>
              {isEditing ? (
                <input
                  type="date"
                  value={
                    editedProfile.birth_date
                      ? editedProfile.birth_date.split('T')[0]
                      : ''
                  }
                  onChange={e =>
                    setEditedProfile({
                      ...editedProfile,
                      birth_date: e.target.value,
                    })
                  }
                  className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                />
              ) : (
                <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                  {profile.birth_date
                    ? new Date(profile.birth_date).toLocaleDateString('de-DE')
                    : t('profile.notSpecified')}
                </div>
              )}
            </div>
          )}
          {/* Change Password */}
          <div className="bg-card border-border mt-6 overflow-hidden rounded-3xl border p-0 shadow-lg md:col-span-2">
            <button
              onClick={() => setShowPwSection(s => !s)}
              className="flex w-full items-center justify-between px-6 py-5"
              aria-expanded={showPwSection}
            >
              <div className="flex items-center gap-3">
                <span className="from-accent to-primary inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                  <Lock className="text-primary-foreground h-5 w-5" />
                </span>
                <span className="text-foreground text-xl font-semibold">
                  {t('profile.changePassword')}
                </span>
              </div>
              <span className="text-muted-foreground text-sm">
                {showPwSection ? t('profile.close') : t('profile.open')}
              </span>
            </button>
            {showPwSection && (
              <div className="px-6 pb-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <label className="text-muted-foreground mb-2 block text-sm font-medium">
                      {t('profile.newPassword')}
                    </label>
                    <input
                      type="password"
                      value={pw1}
                      onChange={e => setPw1(e.target.value)}
                      placeholder={t('profile.passwordPlaceholder')}
                      className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="text-muted-foreground mb-2 block text-sm font-medium">
                      {t('profile.confirmPassword')}
                    </label>
                    <input
                      type="password"
                      value={pw2}
                      onChange={e => setPw2(e.target.value)}
                      className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                {pwMsg && (
                  <div
                    className={`mt-4 rounded-xl border px-4 py-3 text-sm ${pwMsg.includes('erfolgreich') ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}`}
                  >
                    {pwMsg}
                  </div>
                )}
                <div className="mt-6">
                  <button
                    onClick={handlePasswordChange}
                    disabled={pwBusy}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-3 transition-colors disabled:opacity-60"
                  >
                    {pwBusy
                      ? t('profile.changing')
                      : t('profile.changePassword')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="mt-6 flex space-x-4">
            <button
              onClick={handleEditToggle}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              {t('common.save')}
            </button>
            <button
              onClick={handleCancel}
              className="bg-muted text-muted-foreground hover:bg-muted/80 rounded-xl px-6 py-3 transition-colors duration-200"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          {t('profile.statistics')}
        </h2>
        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="sm" />
          </div>
        ) : profile.role === 'trainer' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="glass-effect border-accent/20 rounded-2xl border p-4 text-center">
                <div className="from-accent to-primary mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br">
                  <Users className="text-primary-foreground h-6 w-6" />
                </div>
                <p className="text-foreground text-2xl font-bold">
                  {stats?.trainees ?? 0}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('profile.trainees')}
                </p>
              </div>

              <div className="glass-effect border-accent/20 rounded-2xl border p-4 text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                  <FileText className="text-primary-foreground h-6 w-6" />
                </div>
                <p className="text-foreground text-2xl font-bold">
                  {stats?.totalEnablers ?? 0}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('profile.lessons')}
                </p>
              </div>

              <div className="glass-effect border-accent/20 rounded-2xl border p-4 text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500">
                  <Target className="text-primary-foreground h-6 w-6" />
                </div>
                <p className="text-foreground text-2xl font-bold">
                  {stats?.totalUseCases ?? 0}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('profile.useCases')}
                </p>
              </div>

              <div className="glass-effect border-accent/20 rounded-2xl border p-4 text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500">
                  <GraduationCap className="text-primary-foreground h-6 w-6" />
                </div>
                <p className="text-foreground text-2xl font-bold">
                  {stats?.totalLernfelder ?? 0}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('profile.lernfelder')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="text-center">
              <Award className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.modulesCompleted')}
              </p>
              <p className="text-foreground text-2xl font-bold">12</p>
            </div>
            <div className="text-center">
              <Target className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.certificates')}
              </p>
              <p className="text-foreground text-2xl font-bold">8</p>
            </div>
            <div className="text-center">
              <Clock className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.learningHours')}
              </p>
              <p className="text-foreground text-2xl font-bold">156</p>
            </div>
            <div className="text-center">
              <TrendingUp className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.goalReached')}
              </p>
              <p className="text-foreground text-2xl font-bold">85%</p>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activities */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          {t('profile.recentActivities')}
        </h2>
        {profile.role === 'trainer' ? (
          <div className="space-y-3">
            {statsLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner size="sm" />
              </div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center">
                <Clock className="text-muted-foreground/50 mx-auto mb-3 h-12 w-12" />
                <p className="text-muted-foreground">
                  {t('profile.noActivities')}
                </p>
                <p className="text-muted-foreground/70 mt-1 text-sm">
                  {t('profile.traineeActivities')}
                </p>
              </div>
            ) : (
              activities.map(a => (
                <div
                  key={a.id}
                  className="glass-effect border-accent/10 hover:border-accent/20 flex items-center gap-4 rounded-xl border p-4 transition-colors"
                >
                  <div className="bg-muted/50 flex h-10 w-10 items-center justify-center rounded-xl">
                    {getActivityIcon(a.activityType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate font-medium">
                      {a.userFullName}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {a.details || a.activityType}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">
                Modul &quot;JavaScript Grundlagen&quot; abgeschlossen
              </span>
              <span className="text-muted-foreground ml-auto text-sm">
                vor 2 Stunden
              </span>
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">
                Quiz &quot;HTML &amp; CSS&quot; bestanden
              </span>
              <span className="text-muted-foreground ml-auto text-sm">
                vor 1 Tag
              </span>
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-4">
              <span className="text-muted-foreground">
                Reflexion eingereicht
              </span>
              <span className="text-muted-foreground ml-auto text-sm">
                vor 3 Tagen
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Restart Tour */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-3 text-lg font-bold">
          {t('onboarding.restartTour.title')}
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {t('onboarding.restartTour.desc')}
        </p>
        <button
          onClick={() => restartTour('main')}
          className="border-accent/30 hover:bg-accent/10 rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors"
        >
          {t('onboarding.restartTour.button')}
        </button>
      </div>
    </div>
  );
}
