'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'

export interface BreadcrumbItem {
  label: string
  href: string
  icon?: React.ReactNode
}

interface BreadcrumbContextType {
  breadcrumbs: BreadcrumbItem[]
  addBreadcrumb: (item: BreadcrumbItem) => void
  removeBreadcrumb: (href: string) => void
  clearBreadcrumbs: () => void
  setBreadcrumbs: (items: BreadcrumbItem[]) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined)

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])
  const pathname = usePathname()

  // Initialize breadcrumbs based on current path
  useEffect(() => {
    if (!pathname) return
    
    const pathSegments = pathname.split('/').filter(Boolean)
    const newBreadcrumbs: BreadcrumbItem[] = []

    // Build breadcrumbs from path segments
    let currentPath = ''

    // Role-aware base breadcrumb
    if (pathSegments[0] === 'trainee') {
      newBreadcrumbs.push({ label: 'Trainee', href: '/trainee/dashboard' })
    } else if (pathSegments[0] === 'trainer') {
      newBreadcrumbs.push({ label: 'Trainer', href: '/trainer/dashboard' })
    }

    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`

      // Skip adding the role again since we already added it above
      if (index === 0) return

      // Map segment to readable label
      let label = segment
      if (segment === 'dashboard') label = 'Dashboard'
      else if (segment === 'profile') label = 'Profil'
      else if (segment === 'reflection') label = 'Reflektion'
      else if (segment === 'knowledge-submission') label = 'Wissensabgabe'
      else if (segment === 'modules') label = 'Module'
      else if (segment === 'lessons') label = 'Lektionen'
      else if (segment === 'quizzes') label = 'Quizze'
      else if (segment === 'content-management') label = 'Inhalts-Management'
      else if (segment === 'quiz-management') label = 'Quiz-Verwaltung'
      else if (segment === 'trainees') label = 'Auszubildende'
      else if (segment === 'acceptance-protocol') label = 'Abnahmeprotokoll'
      else if (segment === 'analytics') label = 'Analysen'
      else if (segment === 'login') label = 'Anmeldung'

      // Capitalize first letter
      label = label.charAt(0).toUpperCase() + label.slice(1)

      newBreadcrumbs.push({ label, href: currentPath })
    })

    setBreadcrumbs(newBreadcrumbs)
  }, [pathname])

  const addBreadcrumb = (item: BreadcrumbItem) => {
    setBreadcrumbs(prev => {
      // Check if breadcrumb already exists
      const exists = prev.some(bc => bc.href === item.href)
      if (exists) return prev
      
      return [...prev, item]
    })
  }

  const removeBreadcrumb = (href: string) => {
    setBreadcrumbs(prev => prev.filter(bc => bc.href !== href))
  }

  const clearBreadcrumbs = () => {
    setBreadcrumbs([])
  }

  const value: BreadcrumbContextType = {
    breadcrumbs: breadcrumbs || [], // Ensure breadcrumbs is never undefined
    addBreadcrumb,
    removeBreadcrumb,
    clearBreadcrumbs,
    setBreadcrumbs
  }

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  )
}

export function useBreadcrumbs() {
  const context = useContext(BreadcrumbContext)
  if (context === undefined) {
    throw new Error('useBreadcrumbs must be used within a BreadcrumbProvider')
  }
  return context
}
