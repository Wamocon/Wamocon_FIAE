import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { TRAINEE_MAIN_STEPS } from '@/lib/tour-steps';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');

// WMCNL-2968: the entry "Profil" showed a circle with the letter "L" instead of
// an icon. WMCNL-2967: the platform tour of a trainee did not follow the order
// of the menu and called entries by other names ("Fragenkomplexe" for "Lernen").

function renderTrainee(isMultiple = true) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: {
      id: 'p1',
      full_name: 'Lena Test',
      role: 'trainee',
      avatar: null,
    },
    signOut: jest.fn(),
    loading: false,
    subscriptionPlan: 'LIGHT',
    isAdmin: false,
    isPlatformOwner: false,
  });
  (useCatalog as jest.Mock).mockReturnValue({ isMultiple });
  return renderWithProviders(
    <Sidebar
      currentView="dashboard"
      isOpen
      onToggle={() => {}}
      userRole="trainee"
    />
  );
}

const sidebarEntries = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('a[data-tour^="sidebar-"]')
  );

describe('Sidebar: the entry Profil has an icon, never a letter (WMCNL-2968)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('every entry of the menu, the profile too, shows an icon', () => {
    renderTrainee(false);
    const entries = sidebarEntries();
    expect(entries.length).toBeGreaterThanOrEqual(7);
    for (const entry of entries) {
      expect(entry.querySelector('svg')).not.toBeNull();
    }
  });

  it('the profile entry does not show the first letter of the name', () => {
    renderTrainee(false);
    const profile = screen.getByRole('link', { name: 'Profil' });
    expect(profile.querySelector('svg')).not.toBeNull();
    // the only text of the entry is its label
    expect(profile.textContent).toBe('Profil');
    // and no circle with "L" (Lena) is in the menu
    const nav = document.querySelector('nav') as HTMLElement;
    expect(within(nav).queryByText('L')).toBeNull();
  });
});

describe('The tour of a trainee follows the menu (WMCNL-2967)', () => {
  beforeEach(() => jest.clearAllMocks());

  const stepTarget = (selector: string) =>
    selector.match(/data-tour="([^"]+)"/)?.[1];

  it('goes through the entries of the menu in the order of the menu, then the occupation choice', () => {
    renderTrainee(true);
    // the entries in the order of the page: the menu, then the occupation choice
    const menu = sidebarEntries().map(e => e.getAttribute('data-tour'));
    expect(menu).toEqual([
      'sidebar-dashboard',
      'sidebar-activityReports',
      'sidebar-school',
      'sidebar-courses',
      'sidebar-lessons',
      'sidebar-quizzes',
      'sidebar-profile',
      'sidebar-catalog',
    ]);
    const sidebarSteps = TRAINEE_MAIN_STEPS.map(s =>
      stepTarget(s.targetSelector)
    ).filter(t => t?.startsWith('sidebar-') && t !== 'sidebar-logo');
    expect(sidebarSteps).toEqual(menu);
  });

  it('covers every entry of the menu, Berufsschule and Berufswahl included', () => {
    renderTrainee(true);
    const targets = TRAINEE_MAIN_STEPS.map(s => stepTarget(s.targetSelector));
    for (const entry of sidebarEntries()) {
      expect(targets).toContain(entry.getAttribute('data-tour'));
    }
    expect(targets).toContain('sidebar-school');
    expect(targets).toContain('sidebar-catalog');
  });

  it('names each entry by the key of the menu entry (the same words in German and English)', () => {
    const labelOf: Record<string, string> = {
      'sidebar-dashboard': 'nav.dashboard',
      'sidebar-activityReports': 'nav.activityReports',
      'sidebar-school': 'nav.school',
      'sidebar-courses': 'nav.courses',
      'sidebar-lessons': 'nav.trainerFeedback',
      'sidebar-quizzes': 'nav.quizzes',
      'sidebar-profile': 'nav.profile',
      'sidebar-catalog': 'catalog.tiles.nav',
    };
    const seen: string[] = [];
    for (const step of TRAINEE_MAIN_STEPS) {
      const target = stepTarget(step.targetSelector) ?? '';
      if (!(target in labelOf)) continue;
      seen.push(target);
      expect(step.titleKey).toBe(labelOf[target]);
    }
    expect(seen).toEqual(Object.keys(labelOf));
  });

  it('the titles of the tour are exactly the labels of the menu (German page)', () => {
    renderTrainee(true);
    for (const step of TRAINEE_MAIN_STEPS) {
      const target = stepTarget(step.targetSelector) ?? '';
      if (!target.startsWith('sidebar-') || target === 'sidebar-logo') continue;
      const link = document.querySelector(`[data-tour="${target}"]`);
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe(
        (de as Record<string, string>)[step.titleKey]
      );
    }
  });

  it('no step of the tour uses the old name "Fragenkomplexe" for the menu entry Lernen', () => {
    const courses = TRAINEE_MAIN_STEPS.find(s => s.id === 'courses')!;
    expect((de as Record<string, string>)[courses.titleKey]).toBe('Lernen');
    expect((en as Record<string, string>)[courses.titleKey]).toBe('Learning');
    expect((de as Record<string, string>)[courses.descriptionKey]).not.toMatch(
      /Fragenkomplex/
    );
  });

  it('the step of the occupation choice is optional, it exists only for people with several occupations', () => {
    const catalog = TRAINEE_MAIN_STEPS.find(s => s.id === 'catalog')!;
    expect(catalog.optional).toBe(true);
    // every other step has to be there for everybody
    expect(TRAINEE_MAIN_STEPS.filter(s => s.optional).map(s => s.id)).toEqual([
      'catalog',
    ]);
  });

  it('every text the tour uses exists in German and in English', () => {
    for (const step of TRAINEE_MAIN_STEPS) {
      for (const key of [step.titleKey, step.descriptionKey]) {
        expect((de as Record<string, string>)[key]).toBeTruthy();
        expect((en as Record<string, string>)[key]).toBeTruthy();
      }
    }
  });
});
