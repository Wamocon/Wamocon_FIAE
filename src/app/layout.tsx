import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from 'react-hot-toast';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { BreadcrumbProvider } from '@/contexts/BreadcrumbContext';
import { Analytics } from '@vercel/analytics/react';

import { HaiWrapper } from '@/components/hai';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FIAE Plattform',
  description: 'Eine moderne Lernplattform für FIAE-Auszubildende',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="de"
      className={`${inter.className} dark`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <AuthProvider>
          <LanguageProvider>
            <ThemeProvider>
              <BreadcrumbProvider>
                <HaiWrapper>
                  {children}
                </HaiWrapper>
              </BreadcrumbProvider>
            </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
        <Toaster containerStyle={{ zIndex: 9999 }} />
        <Analytics />
      </body>
    </html>
  );
}
