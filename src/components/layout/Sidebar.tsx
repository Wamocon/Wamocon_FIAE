'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Brain,
  Users,
  Settings,
  LogOut,
  GraduationCap,
  HelpCircle,
  BarChart3,
  FileCheck2,
  Upload,
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
  const { language } = useLanguage();
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
        case 'knowledgeSubmission':
          router.push('/trainee/knowledge-submission');
          break;
        case 'reflection':
          router.push('/trainee/reflection');
          break;
        case 'contentManagement':
          router.push('/trainer/content-management');
          break;
        case 'quizManagement':
          router.push('/trainer/quiz-management');
          break;
        case 'trainees':
          router.push('/trainer/trainees');
          break;
        case 'acceptanceProtocol':
          router.push('/trainer/acceptance-protocol');
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
        label: language === 'de' ? 'Dashboard' : 'Dashboard',
        icon: LayoutDashboard,
        href:
          userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard',
      },
      ...(userRole === 'trainer'
        ? [
            {
              id: 'contentManagement',
              label:
                language === 'de' ? 'Inhalts-Management' : 'Content Management',
              icon: BookOpen,
              href: '/trainer/content-management',
            },
            {
              id: 'quizManagement',
              label: language === 'de' ? 'Quiz-Verwaltung' : 'Quiz Management',
              icon: HelpCircle,
              href: '/trainer/quiz-management',
            },
            {
              id: 'bulkImport',
              label: language === 'de' ? 'Bulk Import' : 'Bulk Import',
              icon: Upload,
              href: '/trainer/bulk-import',
            },
            {
              id: 'trainees',
              label: language === 'de' ? 'Auszubildende' : 'Trainees',
              icon: Users,
              href: '/trainer/trainees',
            },
            {
              id: 'acceptanceProtocol',
              label:
                language === 'de' ? 'Abnahmeprotokoll' : 'Acceptance Protocol',
              icon: FileCheck2,
              href: '/trainer/acceptance-protocol',
            },
            {
              id: 'analytics',
              label: language === 'de' ? 'Analysen' : 'Analytics',
              icon: BarChart3,
              href: '/trainer/analytics',
            },
          ]
        : [
            {
              id: 'knowledgeSubmission',
              label:
                language === 'de' ? 'Wissensabgabe' : 'Knowledge Submission',
              icon: FileText,
              href: '/trainee/knowledge-submission',
            },
            {
              id: 'reflection',
              label: language === 'de' ? 'Reflektion' : 'Reflection',
              icon: Brain,
              href: '/trainee/reflection',
            },
            {
              id: 'courses',
              label: language === 'de' ? 'Kurse' : 'Courses',
              icon: BookOpen,
              href: '/trainee/courses',
            },
            {
              id: 'lessons',
              label: language === 'de' ? 'Trainer-Feedback' : 'Trainer Feedback',
              icon: GraduationCap,
              href: '/trainee/trainer-feedback',
            },
            {
              id: 'quizzes',
              label: language === 'de' ? 'Quizze' : 'Quizzes',
              icon: HelpCircle,
              href: '/trainee/quizzes',
            },
          ]),
      {
        id: 'profile',
        label: language === 'de' ? 'Mein Profil' : 'My Profile',
        icon: Settings,
        href: userRole === 'trainee' ? '/trainee/profile' : '/trainer/profile',
      },
    ],
    [userRole, language]
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
        'lg:static lg:inset-auto lg:translate-x-0 lg:h-full lg:overflow-hidden lg:shrink-0',
        isOpen ? 'lg:w-64 lg:pointer-events-auto' : 'lg:w-0 lg:pointer-events-none',
        // Desktop hover to reveal when collapsed
        'group-hover:lg:w-64 group-hover:lg:pointer-events-auto'
      ].join(' ')}
    >
      <div className="flex h-full flex-col">
        {/* Logo Section */}
        <div className="border-border/50 flex h-16 items-center justify-center border-b px-6">
          <div className="flex items-center space-x-3">
            <div className="from-primary to-primary/80 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br">
              <GraduationCap className="text-primary-foreground h-6 w-6" />
            </div>
            <div>
              <h1 className="text-foreground text-xl font-bold">
                FIAE-Plattform
              </h1>
              <p className="text-muted-foreground text-xs">Learning Platform</p>
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
                className={`flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-accent/20 text-accent border-accent/30 border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
                }`}
              >
                {item.id === 'profile' ? (
                  <Avatar className="h-5 w-5">
                    {profile.avatar ? (
                      <AvatarImage src={profile.avatar} alt={profile.full_name} />
                    ) : (
                      <AvatarFallback>
                        {profile.full_name?.trim()?.charAt(0)?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    )}
                  </Avatar>
                ) : (
                  <Icon className={`h-5 w-5 ${isActive ? 'text-accent' : ''}`} />
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
                      .map((n) => n[0])
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
                {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            disabled={loading}
            className={`mt-3 flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${loading ? 'opacity-60 cursor-not-allowed' : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}`}
          >
            <LogOut className={`h-5 w-5 ${loading ? 'animate-pulse' : ''}`} />
            <span className="font-medium">
              {loading ? (language === 'de' ? 'Abmelden…' : 'Logging out…') : (language === 'de' ? 'Abmelden' : 'Logout')}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
