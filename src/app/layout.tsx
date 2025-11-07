import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from 'react-hot-toast';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { BreadcrumbProvider } from '@/contexts/BreadcrumbContext';

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
                {children}
              </BreadcrumbProvider>
            </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
 