'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';

export interface BreadcrumbItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

interface BreadcrumbContextType {
  breadcrumbs: BreadcrumbItem[];
  addBreadcrumb: (item: BreadcrumbItem) => void;
  removeBreadcrumb: (href: string) => void;
  clearBreadcrumbs: () => void;
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(
  undefined
);

export function BreadcrumbProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const pathname = usePathname();
  const labelCache = useRef<Map<string, string>>(new Map());
  const { t, language } = useLanguage();

  // Memoize breadcrumb building logic to prevent unnecessary recalculations
  const buildBreadcrumbs = useCallback(
    (path: string) => {
      if (!path) return [];

      const pathSegments = path.split('/').filter(Boolean);
      const newBreadcrumbs: BreadcrumbItem[] = [];

      // Build breadcrumbs from path segments
      let currentPath = '';

      // Role-aware base breadcrumb
      if (pathSegments[0] === 'trainee') {
        newBreadcrumbs.push({
          label: t('breadcrumb.trainee'),
          href: '/trainee/dashboard',
        });
      } else if (pathSegments[0] === 'trainer') {
        newBreadcrumbs.push({
          label: t('breadcrumb.trainer'),
          href: '/trainer/dashboard',
        });
      }

      pathSegments.forEach((segment, index) => {
        currentPath += `/${segment}`;

        // Skip adding the role again since we already added it above
        if (index === 0) return;

        // Map segment to readable label
        let label = segment;

        // If it's a UUID-like segment, map it to a friendly static label based on its parent
        const uuidLike = /^[0-9a-fA-F-]{32,36}$/.test(segment);
        if (uuidLike) {
          const prev = pathSegments[index - 1];
          if (prev === 'modules') label = t('breadcrumb.module');
          else if (prev === 'lessons') label = t('breadcrumb.lesson');
          else if (prev === 'quizzes') label = t('breadcrumb.quiz');
          else label = t('breadcrumb.details');
        }
        if (segment === 'dashboard') label = t('breadcrumb.dashboard');
        else if (segment === 'profile') label = t('breadcrumb.profile');
        else if (segment === 'modules') label = t('breadcrumb.modules');
        else if (segment === 'lessons') label = t('breadcrumb.trainerFeedback');
        else if (segment === 'quizzes') label = t('breadcrumb.quizzes');
        else if (segment === 'content-management')
          label = t('breadcrumb.contentManagement');
        else if (segment === 'quiz-management')
          label = t('breadcrumb.quizManagement');
        else if (segment === 'trainees') label = t('breadcrumb.trainees');
        else if (segment === 'analytics') label = t('breadcrumb.analytics');
        else if (segment === 'login') label = t('breadcrumb.login');
        else if (segment === 'school') label = t('breadcrumb.school');

        // Capitalize first letter
        label = label.charAt(0).toUpperCase() + label.slice(1);

        newBreadcrumbs.push({ label, href: currentPath });
      });

      return newBreadcrumbs;
    },
    [t]
  );

  // Initialize breadcrumbs based on current path - optimized with useMemo
  useEffect(() => {
    const newBreadcrumbs = buildBreadcrumbs(pathname);
    setBreadcrumbs(newBreadcrumbs);

    // Enhance UUID labels with entity names (module/trainer-feedback/quiz)
    const enhanceLabels = async () => {
      if (!pathname) return;
      const segments = pathname.split('/').filter(Boolean);
      let currentPath = '';
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        currentPath += `/${segment}`;
        if (index === 0) continue; // skip role
        const uuidLike = /^[0-9a-fA-F-]{32,36}$/.test(segment);
        if (!uuidLike) continue;
        const parent = segments[index - 1];
        let entity: 'module' | 'lesson' | 'quiz' | 'subLesson' | null = null;
        if (parent === 'modules') entity = 'module';
        else if (parent === 'lessons') entity = 'lesson';
        else if (parent === 'quizzes') entity = 'quiz';
        // sub-lesson nested under lessons/<lesson-id>/<sub-lesson-id>
        else if (
          /^[0-9a-fA-F-]{32,36}$/.test(parent) &&
          segments[index - 2] === 'lessons'
        )
          entity = 'subLesson';
        if (!entity) continue;

        const cacheKey = `${entity}:${segment}`;
        let label = labelCache.current.get(cacheKey);
        if (!label) {
          try {
            const res = await fetch(
              `/api/breadcrumb/label?entity=${entity}&id=${segment}`
            );
            if (res.ok) {
              const data = await res.json();
              const name: string | undefined = data?.label;
              if (name) {
                if (entity === 'module')
                  label = `${t('breadcrumb.module')}: ${name}`;
                else if (entity === 'lesson')
                  label = `${t('breadcrumb.lesson')}: ${name}`;
                else if (entity === 'quiz')
                  label = `${t('breadcrumb.quiz')}: ${name}`;
                else if (entity === 'subLesson')
                  label = `${t('breadcrumb.subLesson')}: ${name}`;
                if (label) labelCache.current.set(cacheKey, label);
              }
            }
          } catch (e) {
            // ignore network errors
          }
        }
        if (label) {
          const hrefToReplace = currentPath;
          setBreadcrumbs(prev =>
            prev.map(bc => (bc.href === hrefToReplace ? { ...bc, label } : bc))
          );
        }
      }
    };
    enhanceLabels();
  }, [pathname, buildBreadcrumbs]);

  useEffect(() => {
    labelCache.current.clear();
  }, [language]);

  const addBreadcrumb = useCallback((item: BreadcrumbItem) => {
    setBreadcrumbs(prev => {
      // Check if breadcrumb already exists
      const exists = prev.some(bc => bc.href === item.href);
      if (exists) return prev;

      return [...prev, item];
    });
  }, []);

  const removeBreadcrumb = useCallback((href: string) => {
    setBreadcrumbs(prev => prev.filter(bc => bc.href !== href));
  }, []);

  const clearBreadcrumbs = useCallback(() => {
    setBreadcrumbs([]);
  }, []);

  const setBreadcrumbsCustom = useCallback((items: BreadcrumbItem[]) => {
    setBreadcrumbs(items);
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<BreadcrumbContextType>(
    () => ({
      breadcrumbs: breadcrumbs || [], // Ensure breadcrumbs is never undefined
      addBreadcrumb,
      removeBreadcrumb,
      clearBreadcrumbs,
      setBreadcrumbs: setBreadcrumbsCustom,
    }),
    [
      breadcrumbs,
      addBreadcrumb,
      removeBreadcrumb,
      clearBreadcrumbs,
      setBreadcrumbsCustom,
    ]
  );

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const context = useContext(BreadcrumbContext);
  if (context === undefined) {
    throw new Error('useBreadcrumbs must be used within a BreadcrumbProvider');
  }
  return context;
}
