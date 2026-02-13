'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  Settings,
  LogOut,
  GraduationCap,
  HelpCircle,
  BarChart3,
  Upload,
  School,
  Calendar,
  ClipboardList,
  FolderEdit,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useCallback } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface SidebarProps {
  currentView: string;
  isOpen: boolean;
  onToggle: () => void;
  userRole: 'trainee' | 'trainer';
}

export function Sidebar({
  currentView,
  isOpen,
  onToggle: _onToggle,
  userRole,
}: SidebarProps) {
  const { profile, signOut, loading } = useAuth();
  const { language, t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigation = useCallback(
    (view: string) => {
      // Handle specific navigation directly - no more double navigation
      switch (view) {
        case 'dashboard':
          router.push(
            userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard'
          );
          break;
        case 'profile':
          router.push(
            userRole === 'trainee' ? '/trainee/profile' : '/trainer/profile'
          );
          break;
        case 'contentManagement':
          router.push('/trainer/content-management');
          break;
        case 'quizManagement':
          router.push('/trainer/quiz-management');
          break;
        case 'calendar':
          router.push('/trainer/calendar');
          break;
        case 'trainees':
          router.push('/trainer/trainees');
          break;
        case 'analytics':
          router.push('/trainer/analytics');
          break;
        case 'modules':
          router.push('/trainee/modules');
          break;
        case 'courses':
          router.push('/trainee/courses');
          break;
        case 'lessons':
          router.push('/trainee/trainer-feedback');
          break;
        case 'quizzes':
          router.push('/trainee/quizzes');
          break;
        case 'bulkImport':
          router.push('/trainer/bulk-import');
          break;
        case 'school':
          router.push(
            userRole === 'trainee' ? '/trainee/school' : '/trainer/school'
          );
          break;

        case 'activityReports':
          router.push(
            userRole === 'trainee'
              ? '/trainee/activity-reports'
              : '/trainer/activity-reports'
          );
          break;
        case 'evaluations':
          router.push(
            userRole === 'trainee'
              ? '/trainee/evaluations'
              : '/trainer/evaluations'
          );
          break;
        default:
          router.push(
            userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard'
          );
      }
    },
    [router, userRole]
  );

  const handleSignOut = useCallback(async () => {
    if (loading) return;
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  }, [signOut, loading]);

  // Role-based navigation items - optimized with useMemo
  const navigationItems = useMemo(
    () => [
      {
        id: 'dashboard',
        label: t('nav.dashboard'),
        icon: LayoutDashboard,
        href:
          userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard',
      },
      ...(userRole === 'trainer'
        ? [
          {
            id: 'activityReports',
            label: t('nav.activityReports'),
            icon: ClipboardList,
            href: '/trainer/activity-reports',
          },
          {
            id: 'school',
            label: t('nav.school'),
            icon: School,
            href: '/trainer/school',
          },
          {
            id: 'contentManagement',
            label: t('nav.contentManagement'),
            icon: BookOpen,
            href: '/trainer/content-management',
          },

          {
            id: 'quizManagement',
            label: t('nav.quizzes'),
            icon: HelpCircle,
            href: '/trainer/quiz-management',
          },
          {
            id: 'bulkImport',
            label: t('nav.bulkImport'),
            icon: Upload,
            href: '/trainer/bulk-import',
          },
          {
            id: 'trainees',
            label: t('nav.trainees'),
            icon: Users,
            href: '/trainer/trainees',
          },
          {
            id: 'analytics',
            label: t('nav.analytics'),
            icon: BarChart3,
            href: '/trainer/analytics',
          },
        ]
        : [
          {
            id: 'activityReports',
            label: t('nav.activityReports'),
            icon: ClipboardList,
            href: '/trainee/activity-reports',
          },
          {
            id: 'school',
            label: t('nav.school'),
            icon: School,
            href: '/trainee/school',
          },
          {
            id: 'courses',
            label: t('nav.courses'),
            icon: BookOpen,
            href: '/trainee/courses',
          },

          {
            id: 'lessons',
            label: t('nav.trainerFeedback'),
            icon: GraduationCap,
            href: '/trainee/trainer-feedback',
          },
          {
            id: 'quizzes',
            label: t('nav.quizzes'),
            icon: HelpCircle,
            href: '/trainee/quizzes',
          },
        ]),
      {
        id: 'profile',
        label: t('nav.profile'),
        icon: Settings,
        href: userRole === 'trainee' ? '/trainee/profile' : '/trainer/profile',
      },
    ],
    [userRole, t]
  );

  if (!profile) return null;

  return (
    <aside
      className={[
        'glass-effect border-border/50 border-r transition-all duration-300 ease-in-out',
        // Mobile: slide-in drawer
        'fixed inset-y-0 left-0 z-40 w-64',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: in-flow sidebar that pushes content
        'lg:static lg:inset-auto lg:h-full lg:shrink-0 lg:translate-x-0 lg:overflow-hidden',
        isOpen
          ? 'lg:pointer-events-auto lg:w-64'
          : 'lg:pointer-events-none lg:w-0',
        // Desktop hover to reveal when collapsed
        'group-hover:lg:pointer-events-auto group-hover:lg:w-64',
      ].join(' ')}
    >
      <div className="flex h-full flex-col">
        {/* Logo Section */}
        <div className="border-border/50 flex h-16 items-center justify-start border-b px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="from-primary to-primary/80 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br shadow-md ring-1 ring-white/10">
              <GraduationCap className="text-foreground h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-lg font-semibold tracking-wide">
                {t('sidebar.title')}
              </h1>
              <p className="text-muted-foreground/80 truncate text-[11px] tracking-[0.2em] uppercase">
                {t('sidebar.subtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 px-4 py-6">
          {navigationItems.map(item => {
            const Icon = item.icon;
            // Prefer URL-based active detection to avoid stale props
            const isActive = pathname
              ? pathname === item.href || pathname.startsWith(item.href + '/')
              : currentView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavigation(item.id)}
                className={`flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${isActive
                    ? 'bg-accent/20 text-accent border-accent/30 border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
                  }`}
              >
                {item.id === 'profile' ? (
                  <Avatar className="h-5 w-5">
                    {profile.avatar ? (
                      <AvatarImage
                        src={profile.avatar}
                        alt={profile.full_name}
                      />
                    ) : (
                      <AvatarFallback>
                        {profile.full_name?.trim()?.charAt(0)?.toUpperCase() ||
                          'U'}
                      </AvatarFallback>
                    )}
                  </Avatar>
                ) : (
                  <Icon
                    className={`h-5 w-5 ${isActive ? 'text-accent' : ''}`}
                  />
                )}
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Profile Section */}
        <div className="border-border/50 border-t p-4">
          <div className="bg-background/50 flex items-center space-x-3 rounded-xl p-3">
            <div className="from-accent to-accent/80 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br">
              <Avatar className="h-10 w-10">
                {profile.avatar ? (
                  <AvatarImage src={profile.avatar} alt={profile.full_name} />
                ) : (
                  <AvatarFallback>
                    {profile.full_name
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-sm font-medium">
                {profile.full_name}
              </p>
              <p className="text-muted-foreground text-xs capitalize">
                {profile.role === 'trainee'
                  ? t('roles.trainee')
                  : t('roles.trainer')}
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            disabled={loading}
            className={`mt-3 flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${loading ? 'cursor-not-allowed opacity-60' : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}`}
          >
            <LogOut className={`h-5 w-5 ${loading ? 'animate-pulse' : ''}`} />
            <span className="font-medium">
              {loading ? t('auth.loggingOut') : t('auth.logout')}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
