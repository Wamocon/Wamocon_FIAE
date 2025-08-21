'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
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
  FileCheck2
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useCallback } from 'react'

interface SidebarProps {
  currentView: string
  isOpen: boolean
  onToggle: () => void
  userRole: 'trainee' | 'trainer'
}

export function Sidebar({ currentView, isOpen, onToggle, userRole }: SidebarProps) {
  const { profile, signOut } = useAuth()
  const { language } = useLanguage()
  const router = useRouter()

  const handleNavigation = useCallback((view: string) => {
    // Handle specific navigation directly - no more double navigation
    switch (view) {
      case 'dashboard':
        router.push(userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard')
        break
      case 'profile':
        router.push(userRole === 'trainee' ? '/trainee/profile' : '/trainer/profile')
        break
      case 'knowledgeSubmission':
        router.push('/trainee/knowledge-submission')
        break
      case 'reflection':
        router.push('/trainee/reflection')
        break
      case 'contentManagement':
        router.push('/trainer/content-management')
        break
      case 'quizManagement':
        router.push('/trainer/quiz-management')
        break
      case 'trainees':
        router.push('/trainer/trainees')
        break
      case 'acceptanceProtocol':
        router.push('/trainer/acceptance-protocol')
        break
      case 'analytics':
        router.push('/trainer/analytics')
        break
      case 'modules':
        router.push('/trainee/modules')
        break
      case 'lessons':
        router.push('/trainee/lessons')
        break
      case 'quizzes':
        router.push('/trainee/quizzes')
        break
      default:
        router.push(userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard')
    }
  }, [router, userRole])

  const handleSignOut = useCallback(async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Logout error:', error)
      // Even if there's an error, redirect to login
      router.push('/login')
    }
  }, [signOut, router])

  if (!profile) return null

  // Role-based navigation items - optimized with useMemo
  const navigationItems = useMemo(() => [
    {
      id: 'dashboard',
      label: language === 'de' ? 'Dashboard' : 'Dashboard',
      icon: LayoutDashboard,
      href: userRole === 'trainee' ? '/trainee/dashboard' : '/trainer/dashboard'
    },
    ...(userRole === 'trainer' ? [
      {
        id: 'contentManagement',
        label: language === 'de' ? 'Inhalts-Management' : 'Content Management',
        icon: BookOpen,
        href: '/trainer/content-management'
      },
      {
        id: 'quizManagement',
        label: language === 'de' ? 'Quiz-Verwaltung' : 'Quiz Management',
        icon: HelpCircle,
        href: '/trainer/quiz-management'
      },
      {
        id: 'trainees',
        label: language === 'de' ? 'Auszubildende' : 'Trainees',
        icon: Users,
        href: '/trainer/trainees'
      },
      {
        id: 'acceptanceProtocol',
        label: language === 'de' ? 'Abnahmeprotokoll' : 'Acceptance Protocol',
        icon: FileCheck2,
        href: '/trainer/acceptance-protocol'
      },
      {
        id: 'analytics',
        label: language === 'de' ? 'Analysen' : 'Analytics',
        icon: BarChart3,
        href: '/trainer/analytics'
      }
    ] : [
      {
        id: 'knowledgeSubmission',
        label: language === 'de' ? 'Wissensabgabe' : 'Knowledge Submission',
        icon: FileText,
        href: '/trainee/knowledge-submission'
      },
      {
        id: 'reflection',
        label: language === 'de' ? 'Reflektion' : 'Reflection',
        icon: Brain,
        href: '/trainee/reflection'
      },
      {
        id: 'modules',
        label: language === 'de' ? 'Lernmodule' : 'Learning Modules',
        icon: BookOpen,
        href: '/trainee/modules'
      },
      {
        id: 'lessons',
        label: language === 'de' ? 'Lektionen' : 'Lessons',
        icon: GraduationCap,
        href: '/trainee/lessons'
      },
      {
        id: 'quizzes',
        label: language === 'de' ? 'Quizze' : 'Quizzes',
        icon: HelpCircle,
        href: '/trainee/quizzes'
      }
    ]),
    {
      id: 'profile',
      label: language === 'de' ? 'Mein Profil' : 'My Profile',
      icon: Settings,
      href: userRole === 'trainee' ? '/trainee/profile' : '/trainer/profile'
    }
  ], [userRole, language])

  return (
    <aside className={`${isOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 glass-effect border-r border-border/50 transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0`}>
      <div className="flex flex-col h-full">
        {/* Logo Section */}
        <div className="flex items-center justify-center h-16 px-6 border-b border-border/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">FIAE-Plattform</h1>
              <p className="text-xs text-muted-foreground">Learning Platform</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isActive = currentView === item.id
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavigation(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-accent' : ''}`} />
                <span className="font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* User Profile Section */}
        <div className="p-4 border-t border-border/50">
          <div className="flex items-center space-x-3 p-3 rounded-xl bg-background/50">
            <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent/80 rounded-full flex items-center justify-center">
              <Users className="w-5 h-5 text-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {profile.full_name}
              </p>
              <p className="text-xs text-muted-foreground capitalize">
                {profile.role === 'trainee' ? 'Auszubildender' : 'Ausbilder'}
              </p>
            </div>
          </div>
          
          <button
            onClick={handleSignOut}
            className="w-full mt-3 flex items-center space-x-3 px-4 py-3 rounded-xl text-left text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">
              {language === 'de' ? 'Abmelden' : 'Logout'}
            </span>
          </button>
        </div>
      </div>
    </aside>
  )
}
