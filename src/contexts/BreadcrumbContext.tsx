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

  // Memoize breadcrumb building logic to prevent unnecessary recalculations
  const buildBreadcrumbs = useCallback((path: string) => {
    if (!path) return [];

    const pathSegments = path.split('/').filter(Boolean);
    const newBreadcrumbs: BreadcrumbItem[] = [];

    // Build breadcrumbs from path segments
    let currentPath = '';

    // Role-aware base breadcrumb
    if (pathSegments[0] === 'trainee') {
      newBreadcrumbs.push({ label: 'Trainee', href: '/trainee/dashboard' });
    } else if (pathSegments[0] === 'trainer') {
      newBreadcrumbs.push({ label: 'Trainer', href: '/trainer/dashboard' });
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
        if (prev === 'modules') label = 'Modul';
        else if (prev === 'lessons') label = 'Lektion';
        else if (prev === 'quizzes') label = 'Quiz';
        else label = 'Details';
      }
      if (segment === 'dashboard') label = 'Dashboard';
      else if (segment === 'profile') label = 'Profil';
      else if (segment === 'knowledge-submission') label = 'Wissensabgabe';
      else if (segment === 'modules') label = 'Module';
      else if (segment === 'lessons') label = 'Trainer-Feedback';
      else if (segment === 'quizzes') label = 'Quizze';
      else if (segment === 'content-management') label = 'Inhalts-Management';
      else if (segment === 'quiz-management') label = 'Quiz-Verwaltung';
      else if (segment === 'trainees') label = 'Auszubildende';
      else if (segment === 'analytics') label = 'Analysen';
      else if (segment === 'login') label = 'Anmeldung';
      else if (segment === 'school') label = 'Berufsschule';

      // Capitalize first letter
      label = label.charAt(0).toUpperCase() + label.slice(1);

      newBreadcrumbs.push({ label, href: currentPath });
    });

    return newBreadcrumbs;
  }, []);

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
        else if (/^[0-9a-fA-F-]{32,36}$/.test(parent) && segments[index - 2] === 'lessons') entity = 'subLesson';
        if (!entity) continue;

        const cacheKey = `${entity}:${segment}`;
        let label = labelCache.current.get(cacheKey);
        if (!label) {
          try {
            const res = await fetch(`/api/breadcrumb/label?entity=${entity}&id=${segment}`);
            if (res.ok) {
              const data = await res.json();
              const name: string | undefined = data?.label;
              if (name) {
                if (entity === 'module') label = `Modul: ${name}`;
                else if (entity === 'lesson') label = `Lektion: ${name}`;
                else if (entity === 'quiz') label = `Quiz: ${name}`;
                else if (entity === 'subLesson') label = `Aufgabe: ${name}`;
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
