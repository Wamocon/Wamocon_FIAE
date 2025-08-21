import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { BreadcrumbProvider } from '@/contexts/BreadcrumbContext'
import { memo } from 'react'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'FIAE Plattform',
  description: 'Eine moderne Lernplattform für FIAE-Auszubildende',
}

// Memoize the providers to prevent unnecessary re-renders
const MemoizedProviders = memo(({ children }: { children: React.ReactNode }) => (
  <AuthProvider>
    <LanguageProvider>
      <ThemeProvider>
        <BreadcrumbProvider>
          {children}
        </BreadcrumbProvider>
      </ThemeProvider>
    </LanguageProvider>
  </AuthProvider>
))

MemoizedProviders.displayName = 'MemoizedProviders'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <body className={inter.className}>
        <MemoizedProviders>
          {children}
        </MemoizedProviders>
      </body>
    </html>
  )
}
