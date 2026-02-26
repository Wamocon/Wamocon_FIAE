'use client';

import { useDemo } from './DemoContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  Settings,
  LogOut,
  GraduationCap,
  HelpCircle,
  Upload,
  School,
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface DemoSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function DemoSidebar({ isOpen, onToggle: _onToggle }: DemoSidebarProps) {
  const { profile, role, showDemoToast } = useDemo();
  const { t } = useLanguage();
  const pathname = usePathname();

  const navigationItems = useMemo(
    () => [
      {
        id: 'dashboard',
        label: t('nav.dashboard'),
        icon: LayoutDashboard,
        href: `/demo/${role}/dashboard`,
      },
      ...(role === 'trainer'
        ? [
            {
              id: 'activityReports',
              label: t('nav.activityReports'),
              icon: ClipboardList,
              href: '/demo/trainer/activity-reports',
            },
            {
              id: 'school',
              label: t('nav.school'),
              icon: School,
              href: '/demo/trainer/school',
            },
            {
              id: 'contentManagement',
              label: t('nav.contentManagement'),
              icon: BookOpen,
              href: '/demo/trainer/content-management',
            },
            {
              id: 'quizManagement',
              label: t('nav.quizzes'),
              icon: HelpCircle,
              href: '/demo/trainer/quiz-management',
            },
            {
              id: 'bulkImport',
              label: t('nav.bulkImport'),
              icon: Upload,
              href: '/demo/trainer/bulk-import',
            },
            {
              id: 'trainees',
              label: t('nav.trainees'),
              icon: Users,
              href: '/demo/trainer/trainees',
            },
          ]
        : [
            {
              id: 'activityReports',
              label: t('nav.activityReports'),
              icon: ClipboardList,
              href: '/demo/trainee/activity-reports',
            },
            {
              id: 'school',
              label: t('nav.school'),
              icon: School,
              href: '/demo/trainee/school',
            },
            {
              id: 'courses',
              label: t('nav.courses'),
              icon: BookOpen,
              href: '/demo/trainee/courses',
            },
            {
              id: 'lessons',
              label: t('nav.trainerFeedback'),
              icon: GraduationCap,
              href: '/demo/trainee/trainer-feedback',
            },
            {
              id: 'quizzes',
              label: t('nav.quizzes'),
              icon: HelpCircle,
              href: '/demo/trainee/quizzes',
            },
          ]),
      {
        id: 'profile',
        label: t('nav.profile'),
        icon: Settings,
        href: `/demo/${role}/profile`,
      },
    ],
    [role, t]
  );

  // Pages that exist in demo
  const availableHrefs = new Set([
    '/demo/trainee/dashboard',
    '/demo/trainee/courses',
    '/demo/trainee/profile',
    '/demo/trainee/school',
    '/demo/trainer/dashboard',
    '/demo/trainer/content-management',
    '/demo/trainer/trainees',
    '/demo/trainer/activity-reports',
  ]);

  return (
    <aside
      className={[
        'glass-effect border-border/50 border-r transition-all duration-300 ease-in-out',
        'fixed inset-y-0 left-0 z-40 w-64',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:static lg:inset-auto lg:h-full lg:shrink-0 lg:translate-x-0 lg:overflow-hidden',
        isOpen
          ? 'lg:pointer-events-auto lg:w-64'
          : 'lg:pointer-events-none lg:w-0',
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
            const isActive = pathname
              ? pathname === item.href || pathname.startsWith(item.href + '/')
              : false;
            const isAvailable = availableHrefs.has(item.href);

            if (!isAvailable) {
              return (
                <button
                  key={item.id}
                  onClick={() => showDemoToast('Diese Seite')}
                  className="flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 cursor-not-allowed"
                  style={{ opacity: 0.35 }}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-accent/20 text-accent border-accent/30 border'
                    : 'hover:bg-accent/10 hover:ring-1 hover:ring-accent'
                }`}
              >
                {item.id === 'profile' ? (
                  <Avatar className="h-5 w-5">
                    <AvatarFallback>
                      {profile.full_name?.trim()?.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Icon className={`h-5 w-5 ${isActive ? 'text-accent' : ''}`} />
                )}
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Profile Section */}
        <div className="border-border/50 border-t p-4">
          <div className="bg-background/50 flex items-center space-x-3 rounded-xl p-3">
            <div className="from-accent to-accent/80 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br">
              <Avatar className="h-10 w-10">
                <AvatarFallback>
                  {profile.full_name
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-sm font-medium">
                {profile.full_name}
              </p>
              <p className="text-muted-foreground text-xs capitalize">
                {profile.role === 'trainee' ? t('roles.trainee') : t('roles.trainer')}
              </p>
            </div>
          </div>

          <button
            onClick={() => showDemoToast('Abmelden')}
            className="mt-3 flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-left text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-accent/10 hover:ring-1 hover:ring-accent"
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">{t('auth.logout')}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
