'use client';

import { authFetch } from '@/lib/authFetch';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  User,
  Edit3,
  Award,
  Clock,
  Target,
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
import { withStoragePrefix } from '@/lib/db-schema';
import { FILE_UPLOAD } from '@/lib/constants';
import { isValidPassword } from '@/lib/auth/password-policy';
import { isPasswordChangeError } from '@/lib/auth/password-change';
import { PASS_THRESHOLD } from '@/lib/catalog/progression';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { getAusbildungDurationLabel } from '@/lib/ausbildung/duration';
import { HaiMemoryPanel } from '@/components/hai/HaiMemoryPanel';

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
};

/** The own figures of a trainee (GET /api/trainee/profile-summary). */
type TraineeStats = {
  lessonsCompleted: number;
  lessonsTotal: number;
  quizzesPassed: number;
  useCasesApproved: number;
};

type ActivityItem = {
  id: string;
  /** Trainer view only: the trainee who did it, null if the name is unknown. */
  userFullName?: string | null;
  activityType: string;
  itemTitle?: string | null;
  score?: number | null;
  status?: string | null;
  createdAt: string | null;
};

export function Profile() {
  const { profile, updateProfile, changePassword } = useAuth();
  const { t } = useLanguage();
  const { restartTour } = useOnboarding();
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Only the fields a person may change here: the name and, for a trainee,
  // the birth date. The e-mail address (the login), the role and the start of
  // the training are shown, never edited (the database refuses them anyway).
  const [editedProfile, setEditedProfile] = useState({
    full_name: profile?.full_name || '',
    birth_date: profile?.birth_date || '',
  });
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [traineeStats, setTraineeStats] = useState<TraineeStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [showPwSection, setShowPwSection] = useState(false);

  // Load the figures and the recent activities: of the trainees in the scope
  // for a trainer or admin, the own ones for a trainee. Both routes answer for
  // the occupation of the chosen tab (authFetch sends x-catalog).
  useEffect(() => {
    const load = async () => {
      try {
        if (!profile?.id) {
          setStatsLoading(false);
          return;
        }
        const trainerLevel = isTrainerLevelRole(profile.role);
        if (!trainerLevel && profile.role !== 'trainee') {
          setStatsLoading(false);
          return;
        }
        const url = trainerLevel
          ? '/api/trainer/profile'
          : '/api/trainee/profile-summary';
        const res = await authFetch(url, { cache: 'no-store' });
        if (!res.ok) {
          setStatsFailed(true);
          setStatsLoading(false);
          return;
        }
        const data = await res.json();
        if (trainerLevel) {
          setStats(data.counts || null);
        } else {
          setTraineeStats(data.stats || null);
        }
        const recent = Array.isArray(data.recentActivities)
          ? data.recentActivities.map((r: any) => ({
              id: r.id,
              userFullName: r.userFullName ?? null,
              activityType: r.activityType,
              itemTitle: r.itemTitle ?? null,
              score: typeof r.score === 'number' ? r.score : null,
              status: r.status ?? null,
              createdAt: r.createdAt
                ? new Date(r.createdAt).toISOString()
                : null,
            }))
          : [];
        setActivities(recent);
      } catch (e) {
        console.error(e);
        setStatsFailed(true);
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
      birth_date: profile.birth_date || '',
    });
    setIsEditing(false);
  };

  const handleEditToggle = async () => {
    if (isEditing) {
      // Save changes when exiting edit mode. Only the fields of this form are
      // written: the name, and the birth date of a trainee. The start of the
      // training and the e-mail address are not part of it.
      try {
        await updateProfile({
          full_name: editedProfile.full_name,
          ...(profile.role === 'trainee'
            ? { birth_date: editedProfile.birth_date || null }
            : {}),
        });
        toast.success(t('profile.updateSuccess') || 'Profil aktualisiert');
      } catch (e) {
        console.error('Profile update error:', e);
        toast.error(t('profile.updateFailed'));
        return;
      }
    } else {
      // Reset to current profile data when entering edit mode
      setEditedProfile({
        full_name: profile.full_name || '',
        birth_date: profile.birth_date || '',
      });
    }
    setIsEditing(!isEditing);
  };

  const handlePasswordChange = async () => {
    setPwMsg(null);
    setPwOk(false);
    if (!pwCurrent) {
      setPwMsg(t('profile.passwordError.CURRENT_PASSWORD_REQUIRED'));
      return;
    }
    if (!isValidPassword(pw1)) {
      setPwMsg(t('profile.passwordMinLength'));
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg(t('profile.passwordMismatch'));
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(pwCurrent, pw1);
      setPwOk(true);
      setPwMsg(t('profile.passwordChanged'));
      setPwCurrent('');
      setPw1('');
      setPw2('');
    } catch (e: unknown) {
      // Only the code of the failure is used, the text comes from the
      // translation system (no detail of the authentication is shown)
      setPwMsg(
        t(
          `profile.passwordError.${isPasswordChangeError(e) ? e.code : 'FAILED'}`
        )
      );
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
      // Preview uploads go under preview/ in the shared bucket
      const path = withStoragePrefix(
        `${profile.id}/${Date.now()}_${file.name}`
      );
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

  // The text of an activity, built from structured values (type, title, score,
  // status) with the translation system
  const describeActivity = (a: ActivityItem) => {
    const title = a.itemTitle || t('profile.activity.untitled');
    const fill = (key: string) =>
      t(key)
        .replace('{title}', title)
        .replace('{score}', String(Math.round(a.score ?? 0)));
    if (a.activityType === 'LESSON_COMPLETED') {
      return fill('profile.activity.lessonCompleted');
    }
    if (a.activityType === 'QUIZ_SUBMITTED') {
      if (a.score === null || a.score === undefined) {
        return fill('profile.activity.quizPending');
      }
      return fill(
        a.score >= PASS_THRESHOLD
          ? 'profile.activity.quizPassed'
          : 'profile.activity.quizFailed'
      );
    }
    if (a.activityType === 'USECASE_SUBMITTED') {
      return fill(
        a.status === 'APPROVED'
          ? 'profile.activity.useCaseApproved'
          : 'profile.activity.useCaseSubmitted'
      );
    }
    return a.activityType;
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

  const durationYears = profile.ausbildung_duration_years ?? 3;
  const durationLabel = getAusbildungDurationLabel(durationYears);

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
              {profile.full_name}
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
                data-hai-form="profile_name"
                data-hai-field="fullName"
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
            <div
              className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3"
              data-testid="user-email"
            >
              {profile.email}
            </div>
            {isEditing && (
              <p
                className="text-muted-foreground mt-2 text-xs"
                data-testid="email-read-only-hint"
              >
                {t('profile.emailReadOnly')}
              </p>
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
          {/* Start of the training: maintained by the trainer or administration.
              The internal user id of a trainer is no business of the page. */}
          {profile.role === 'trainee' && (
            <div>
              <label className="text-muted-foreground mb-2 block text-sm font-medium">
                {t('profile.trainingStart')}
              </label>
              <div className="bg-muted border-border text-foreground rounded-2xl border px-4 py-3">
                {profile.training_start_date || t('profile.notSpecified')}
              </div>
              {!profile.training_start_date && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('profile.trainingStartHint')}
                </p>
              )}
            </div>
          )}
          {profile.role === 'trainee' && (
            <div>
              <label className="text-muted-foreground mb-2 block text-sm font-medium">
                {t('trainee.detail.durationYears')}
              </label>
              <div className="bg-muted border-border text-foreground flex items-center gap-2 rounded-2xl border px-4 py-3">
                <GraduationCap className="text-accent h-4 w-4" />
                <span>{durationLabel}</span>
              </div>
            </div>
          )}
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
                  <div className="md:col-span-2">
                    <label
                      htmlFor="currentPassword"
                      className="text-muted-foreground mb-2 block text-sm font-medium"
                    >
                      {t('profile.currentPassword')}
                    </label>
                    <input
                      id="currentPassword"
                      type="password"
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      aria-required="true"
                      className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                      autoComplete="current-password"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="newPassword"
                      className="text-muted-foreground mb-2 block text-sm font-medium"
                    >
                      {t('profile.newPassword')}
                    </label>
                    <input
                      id="newPassword"
                      type="password"
                      value={pw1}
                      onChange={e => setPw1(e.target.value)}
                      placeholder={t('profile.passwordPlaceholder')}
                      className="bg-muted border-border text-foreground focus:ring-accent w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="confirmPassword"
                      className="text-muted-foreground mb-2 block text-sm font-medium"
                    >
                      {t('profile.confirmPassword')}
                    </label>
                    <input
                      id="confirmPassword"
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
                    role="status"
                    data-testid="password-message"
                    className={`mt-4 rounded-xl border px-4 py-3 text-sm ${pwOk ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}`}
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
        ) : statsFailed ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {t('profile.stats.unavailable')}
          </p>
        ) : isTrainerLevelRole(profile.role) ? (
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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="text-center" data-testid="stat-lessons">
              <Award className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.stats.lessonsCompleted')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {traineeStats?.lessonsCompleted ?? 0}
              </p>
              {!!traineeStats?.lessonsTotal && (
                <p className="text-muted-foreground text-xs">
                  {t('profile.stats.lessonsOf').replace(
                    '{total}',
                    String(traineeStats.lessonsTotal)
                  )}
                </p>
              )}
            </div>
            <div className="text-center" data-testid="stat-quizzes">
              <CheckCircle className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.stats.quizzesPassed')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {traineeStats?.quizzesPassed ?? 0}
              </p>
            </div>
            <div className="text-center" data-testid="stat-use-cases">
              <Target className="text-accent mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('profile.stats.useCasesApproved')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {traineeStats?.useCasesApproved ?? 0}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activities */}
      <div className="bg-card border-border mt-6 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          {t('profile.recentActivities')}
        </h2>
        <div className="space-y-3">
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="sm" />
            </div>
          ) : activities.length === 0 ? (
            <div className="py-8 text-center">
              <Clock className="text-muted-foreground/50 mx-auto mb-3 h-12 w-12" />
              {isTrainerLevelRole(profile.role) ? (
                <>
                  <p className="text-muted-foreground">
                    {t('profile.noActivities')}
                  </p>
                  <p className="text-muted-foreground/70 mt-1 text-sm">
                    {t('profile.traineeActivities')}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {t('profile.noActivitiesOwn')}
                </p>
              )}
            </div>
          ) : (
            activities.map(a => (
              <div
                key={`${a.activityType}-${a.id}`}
                className="glass-effect border-accent/10 hover:border-accent/20 flex items-center gap-4 rounded-xl border p-4 transition-colors"
              >
                <div className="bg-muted/50 flex h-10 w-10 items-center justify-center rounded-xl">
                  {getActivityIcon(a.activityType)}
                </div>
                <div className="min-w-0 flex-1">
                  {isTrainerLevelRole(profile.role) ? (
                    <>
                      <p className="text-foreground truncate font-medium">
                        {a.userFullName || t('profile.unknown')}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {describeActivity(a)}
                      </p>
                    </>
                  ) : (
                    <p className="text-foreground truncate font-medium">
                      {describeActivity(a)}
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground text-sm whitespace-nowrap">
                  {formatRelativeTime(a.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* What the HAI remembers about the person (nothing shown while it is off) */}
      <HaiMemoryPanel />

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
