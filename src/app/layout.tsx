import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from 'react-hot-toast';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { BreadcrumbProvider } from '@/contexts/BreadcrumbContext';
import { Analytics } from '@vercel/analytics/react';
import dynamic from 'next/dynamic';
import QueryProvider from '@/components/QueryProvider';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { TourOverlay } from '@/components/onboarding/TourOverlay';
import { SidebarProvider } from '@/contexts/SidebarContext';

// Lazy-load HAI chat widget - it's not needed for initial page render
// Import directly instead of through barrel to avoid pulling in all HAI modules
const HaiWrapper = dynamic(() =>
  import('@/components/hai/HaiWrapper').then(mod => ({
    default: mod.HaiWrapper,
  }))
);

export const metadata: Metadata = {
  title: 'LFA Plattform',
  description: 'Eine moderne Lernplattform für LFA-Auszubildende',
  icons: {
    icon: '/WMC_Logo.png',
    apple: '/WMC_Logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>
          <QueryProvider>
            <LanguageProvider>
              <ThemeProvider>
                <BreadcrumbProvider>
                  <SidebarProvider>
                    <OnboardingProvider>
                      <HaiWrapper>{children}</HaiWrapper>
                      <TourOverlay />
                    </OnboardingProvider>
                  </SidebarProvider>
                </BreadcrumbProvider>
              </ThemeProvider>
            </LanguageProvider>
          </QueryProvider>
        </AuthProvider>
        <Toaster containerStyle={{ zIndex: 9999 }} />
        <Analytics />
      </body>
    </html>
  );
}
